/**
 * FreeGPT.tech provider — WASM-secured OpenAI-compatible gateway.
 *
 * Host: https://standalone.freegpt.win:3001  (backup host, no Cloudflare)
 *
 * Each request goes through a proof-of-work challenge handshake:
 *   1. Generate a fresh UUID (per-request identity).
 *   2. GET /api/challenge with the uuid → server returns a challenge +
 *      difficulty level.
 *   3. Run the WASM signer (src/lib/freegpt-signer.cjs, loaded from
 *      wasm_signer_bg.wasm) to compute the secure payload (signature,
 *      nonce, timestamp) bound to (uuid, challenge, clientIp, difficulty).
 *   4. POST /api/openai/oneapi/v1/chat/completions with all x-secure-*
 *      headers (and an empty cf-turnstile-token) plus the OpenAI-shaped
 *      request body.
 *   5. Parse the OpenAI-format response — streaming (SSE) or non-streaming
 *      (JSON).
 *
 * The WASM signer is a Node-only CommonJS module (uses jsdom for browser
 * API mocking for canvas fingerprinting), loaded lazily on first request
 * via require(). It runs only on the server — the chat route already
 * declares `runtime = "nodejs"`.
 *
 * Challenges are single-use and valid for ~5 minutes, so we mint a new
 * one for every request — never reused.
 *
 * Rate limit: 8 requests/minute per client IP (best-effort, in-memory).
 */

import path from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import type { Provider, ProviderCompletionRequest } from "./types";

const BASE_URL = "https://standalone.freegpt.win:3001";
const CHALLENGE_PATH = "/api/challenge";
const FALLBACK_URL = "https://standalone.freegpt.win:3001";
const COMPLETIONS_PATH = "/api/openai/oneapi/v1/chat/completions";

/** Maximum requests per minute per client IP. */
const RATE_LIMIT_PER_MIN = 8;

// ─── WASM signer lazy loader ──────────────────────────────────────────────
type SignerModule = {
  initWasm: (wasmPath: string) => Promise<void>;
  generateSecurePayload: (
    uuid: string,
    timestamp: string,
    nonce: string,
    challenge: string,
    clientIp: string,
    difficulty: number,
  ) => Record<string, unknown> | string;
};

let signerLoaded = false;
let signerLoadPromise: Promise<void> | null = null;
let signerModule: SignerModule | null = null;

/**
 * Lazily load + initialise the WASM signer on first use. Concurrent first
 * requests share the same load promise (no double-init). The signer is a
 * CommonJS module that depends on jsdom + fs and can only run on the
 * server (the chat route declares `runtime = "nodejs"`).
 *
 * The require() call is hidden behind `eval("require")` so webpack /
 * Turbopack cannot statically analyze it and accidentally bundle the
 * signer (and its jsdom dependency tree, which needs `fs`) into client
 * bundles. The MODELS registry is imported by client components
 * (playground, models-showcase), so any statically-analyzable require
 * in this file would be pulled into the client graph.
 *
 * The signer is resolved with an absolute path (process.cwd() +
 * src/lib/freegpt-signer.cjs) because Next.js bundles route handlers
 * into chunk files under .next/dev/server/chunks/, and a relative
 * require would be resolved relative to the chunk file, not the source.
 *
 * On the client, `require` is not defined — but this function is only
 * invoked from the chat API route handler (server-side), so the eval
 * never executes in a browser context.
 */
async function ensureSignerLoaded(): Promise<SignerModule> {
  if (signerLoaded && signerModule) return signerModule;
  if (!signerLoadPromise) {
    signerLoadPromise = (async () => {
      const dynamicRequire = eval("require") as NodeRequire;
      const signerPath = path.join(
        process.cwd(),
        "src",
        "lib",
        "freegpt-signer.cjs",
      );
      const mod: SignerModule = dynamicRequire(signerPath);
      const wasmPath = path.join(process.cwd(), "wasm_signer_bg.wasm");
      await mod.initWasm(wasmPath);
      signerModule = mod;
      signerLoaded = true;
    })();
  }
  await signerLoadPromise;
  return signerModule!;
}

// ─── Simple in-memory rate limiter (8 req/min/IP) ─────────────────────────
interface RateBucket {
  count: number;
  windowStart: number;
}
const rateBuckets = new Map<string, RateBucket>();

/** Returns true if the request is allowed, false if rate-limited. */
function rateLimitCheck(ip: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.windowStart > 60_000) {
    rateBuckets.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (bucket.count >= RATE_LIMIT_PER_MIN) return false;
  bucket.count++;
  return true;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Random hex nonce, 32 chars (16 bytes). */
function makeNonce(): string {
  return randomBytes(16).toString("hex");
}

/** Best-effort client IP extraction from request headers. */
function extractClientIp(req: ProviderCompletionRequest): string {
  // ProviderCompletionRequest doesn't carry headers, but we still want a
  // stable-ish per-process identifier. We use a constant placeholder; the
  // upstream validates the signature, not the actual IP.
  return "127.0.0.1";
}

/**
 * Fetch a fresh challenge for the given uuid. Returns the challenge string
 * and difficulty level. The challenge is single-use and valid ~5 minutes.
 */
async function fetchChallenge(uuid: string): Promise<{
  challenge: string;
  difficulty: number;
}> {
  const res = await fetch(`${BASE_URL}${CHALLENGE_PATH}`, {
    method: "GET",
    headers: {
      "x-secure-uuid": uuid,
      "x-secure-client-ip": "127.0.0.1",
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(
      `FreeGPT challenge returned HTTP ${res.status}: ${txt.slice(0, 200)}`,
    );
  }
  const json = (await res.json()) as Record<string, unknown>;
  // Be defensive — the API may use any of several field names.
  const challenge =
    (json.challenge as string) ??
    (json.token as string) ??
    (json.challenge_token as string) ??
    "";
  const difficulty =
    (json.difficulty as number) ??
    (json.level as number) ??
    4;
  if (!challenge) {
    throw new Error(
      `FreeGPT challenge response missing 'challenge' field: ${JSON.stringify(json).slice(0, 200)}`,
    );
  }
  return { challenge, difficulty };
}

/**
 * Convert the secure-payload object returned by the WASM signer into a
 * flat HTTP header map. The WASM returns an object shaped like:
 *   {
 *     signature:  "<hex>",
 *     fingerprint:"<fp>",
 *     client_ip:  "<ip>",
 *     v:          "<version>",
 *     pow: { seed_nonce, nonce, hash, difficulty }
 *   }
 *
 * We flatten nested objects with `-` and snake_case → kebab-case, then
 * prefix every key with `x-secure-` so the upstream FreeGPT middleware
 * receives them as `x-secure-signature`, `x-secure-pow-nonce`, etc.
 */
function securePayloadToHeaders(
  payload: Record<string, unknown> | string,
): Record<string, string> {
  let obj: Record<string, unknown>;
  if (typeof payload === "string") {
    try {
      obj = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      // Not JSON — treat the whole string as a single signature header.
      return { "x-secure-signature": payload };
    }
  } else {
    obj = payload;
  }
  const headers: Record<string, string> = {};

  function walk(prefix: string, value: unknown) {
    if (value === null || value === undefined) return;
    if (typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const key = k.replace(/_/g, "-");
        walk(prefix ? `${prefix}-${key}` : `x-secure-${key}`, v);
      }
      return;
    }
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      headers[prefix] = String(value);
    }
  }

  walk("", obj);
  return headers;
}

/** Standard OpenAI SSE line parser → content delta or null. */
function parseOpenAISseLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const data = trimmed.slice(5).trim();
  if (!data || data === "[DONE]") return null;
  try {
    const json = JSON.parse(data) as {
      choices?: Array<{ delta?: { content?: string } }>;
    };
    const delta = json?.choices?.[0]?.delta?.content;
    return typeof delta === "string" ? delta : null;
  } catch {
    return null;
  }
}

/** Extract assistant text from a non-streaming OpenAI-compatible JSON body. */
function extractNonStreamText(json: unknown): string {
  type OpenAiShape = {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const data = json as OpenAiShape | undefined;
  const text = data?.choices?.[0]?.message?.content;
  return typeof text === "string" ? text : "";
}

// ─── Provider ─────────────────────────────────────────────────────────────

export const freeGptProvider: Provider = {
  id: "freegpt",

  async complete(req) {
    // Rate limit
    if (!rateLimitCheck(extractClientIp(req))) {
      throw new Error("FreeGPT rate limit exceeded (8 req/min). Try again shortly.");
    }

    const signer = await ensureSignerLoaded();

    // 1. Fresh UUID per request
    const uuid = randomUUID();

    // 2. Fetch challenge
    const { challenge, difficulty } = await fetchChallenge(uuid);

    // 3. Generate secure payload via WASM signer
    const timestamp = Date.now().toString();
    const nonce = makeNonce();
    const clientIp = "127.0.0.1";
    const payload = signer.generateSecurePayload(
      uuid,
      timestamp,
      nonce,
      challenge,
      clientIp,
      difficulty,
    );

    // 4. Build headers — secure payload fields + explicit uuid/challenge +
    //    empty cf-turnstile-token (server allows empty for non-CF host).
    const secureHeaders = securePayloadToHeaders(payload);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      "x-secure-uuid": uuid,
      "x-secure-challenge": challenge,
      "x-secure-client-ip": clientIp,
      "cf-turnstile-token": "",
      ...secureHeaders,
    };

    // 5. POST completion (non-streaming)
    const body = {
      model: req.model.upstream,
      messages: req.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: false,
    };

    const res = await fetch(`${BASE_URL}${COMPLETIONS_PATH}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: req.signal,
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(
        `FreeGPT returned HTTP ${res.status}: ${txt.slice(0, 200)}`,
      );
    }

    const json = (await res.json()) as unknown;
    const text = extractNonStreamText(json);
    if (!text) {
      throw new Error(
        `FreeGPT response missing choices[0].message.content: ${JSON.stringify(json).slice(0, 200)}`,
      );
    }
    return { text };
  },

  async *stream(req) {
    // Rate limit
    if (!rateLimitCheck(extractClientIp(req))) {
      throw new Error("FreeGPT rate limit exceeded (8 req/min). Try again shortly.");
    }

    const signer = await ensureSignerLoaded();

    // 1. Fresh UUID per request
    const uuid = randomUUID();

    // 2. Fetch challenge
    const { challenge, difficulty } = await fetchChallenge(uuid);

    // 3. Generate secure payload via WASM signer
    const timestamp = Date.now().toString();
    const nonce = makeNonce();
    const clientIp = "127.0.0.1";
    const payload = signer.generateSecurePayload(
      uuid,
      timestamp,
      nonce,
      challenge,
      clientIp,
      difficulty,
    );

    // 4. Build headers
    const secureHeaders = securePayloadToHeaders(payload);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      "x-secure-uuid": uuid,
      "x-secure-challenge": challenge,
      "x-secure-client-ip": clientIp,
      "cf-turnstile-token": "",
      ...secureHeaders,
    };

    // 5. POST completion (streaming)
    const body = {
      model: req.model.upstream,
      messages: req.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: true,
    };

    const res = await fetch(`${BASE_URL}${COMPLETIONS_PATH}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: req.signal,
    });

    if (!res.ok || !res.body) {
      const txt = await res.text().catch(() => "");
      throw new Error(
        `FreeGPT returned HTTP ${res.status}: ${txt.slice(0, 200)}`,
      );
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const delta = parseOpenAISseLine(line);
          if (delta) yield delta;
        }
      }
      // Flush remaining
      const delta = parseOpenAISseLine(buffer);
      if (delta) yield delta;
    } finally {
      reader.releaseLock();
    }
  },
};

/**
 * FreeGPT.tech provider — WASM-secured OpenAI-compatible gateway.
 *
 * Host: https://freegpt.tech (Cloudflare-protected, proper headers required)
 *
 * Each request goes through a proof-of-work challenge handshake:
 *   1. Generate a fresh UUID (per-request identity, custom format like
 *      R526072895DLHQJQ38S9SCHY8 — NOT UUID v4).
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
 * Required headers beyond the secure payload:
 *   - uuid:       Custom format ID (e.g., R526072895DLHQJQ38S9SCHY8)
 *   - userid:    Short alphanumeric user ID (e.g., 7HEnCbQpBgjpWf9RtceDB)
 *   - x-session-id: UUID v4 session identifier
 *   - x-finger:  Browser fingerprint hash
 *   - summarize: "false"
 *   - model:     The model name being requested
 *
 * The WASM signer is a Node-only CommonJS module (uses jsdom for browser
 * API mocking for canvas fingerprinting), loaded lazily on first request
 * via require(). It runs only on the server — the chat route already
 * declares `runtime = "nodejs"`.
 *
 * Challenges are single-use and valid for ~5 minutes, so we mint a new
 * one for every request — never reused.
 *
 * Rate limit: 30 requests/minute per client IP (best-effort, in-memory).
 */

import type { Provider, ProviderCompletionRequest } from "./types";

// Node.js modules are imported lazily inside functions so this file can be
// bundled for Edge runtime without breaking. The actual calls only happen
// in the Node.js proxy route.

const BASE_URL = "https://freegpt.tech";
const CHALLENGE_PATH = "/api/challenge";
const COMPLETIONS_PATH = "/api/openai/oneapi/v1/chat/completions";

/** Fallback host (direct, no Cloudflare) — may also be blocked. */
const FALLBACK_BASE_URL = "https://standalone.freegpt.win:3001";

/** Maximum requests per minute per client IP. */
const RATE_LIMIT_PER_MIN = 30;

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
      // Dynamic import of Node.js modules — only runs in Node.js runtime
      const nodePath = await import("node:path");
      const dynamicRequire = eval("require") as NodeRequire;
      const signerPath = nodePath.join(
        process.cwd(),
        "src",
        "lib",
        "freegpt-signer.cjs",
      );
      const mod: SignerModule = dynamicRequire(signerPath);
      const wasmPath = nodePath.join(process.cwd(), "wasm_signer_bg.wasm");
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
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Generate a FreeGPT-style UUID — uppercase alphanumeric, ~24 chars.
 * Format like: R526072895DLHQJQ38S9SCHY8
 * This is the format FreeGPT expects, NOT standard UUID v4.
 */
function makeFreeGptUuid(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => chars[b % chars.length]).join("");
}

/**
 * Generate a short userid — alphanumeric, ~20 chars.
 * Format like: 7HEnCbQpBgjpWf9RtceDB
 */
function makeUserId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => chars[b % chars.length]).join("");
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
 * Tries the primary host (freegpt.tech) first, then fallback host.
 */
async function fetchChallenge(uuid: string): Promise<{
  challenge: string;
  difficulty: number;
  challengeId: string;
  expiresAt: number;
  version: string;
  baseUrl: string;
}> {
  const challengeHeaders = {
    uuid: uuid,
    "x-origin": "https://freegpt.tech",
    Accept: "application/json",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    Referer: "https://freegpt.tech/",
    "Accept-Language": "en-US,en;q=0.9",
  };

  // Try both hosts — primary (Cloudflare) then fallback (direct)
  const hosts = [BASE_URL, FALLBACK_BASE_URL];
  let lastError = "";

  for (const host of hosts) {
    try {
      const res = await fetch(`${host}${CHALLENGE_PATH}`, {
        method: "GET",
        headers: challengeHeaders,
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        lastError = `HTTP ${res.status} from ${host}`;
        continue; // Try next host
      }
      const json = (await res.json()) as Record<string, unknown>;
      const challenge =
        (json.challenge as string) ??
        (json.token as string) ??
        (json.challenge_token as string) ??
        "";
      const difficulty =
        (json.difficulty as number) ??
        (json.level as number) ??
        2;
      const challengeId = (json.challengeId as string) ?? "";
      const expiresAt = (json.expiresAt as number) ?? 0;
      const version = (json.version as string) ?? "1.0";
      if (!challenge || !challengeId) {
        lastError = `Unexpected challenge response from ${host}`;
        continue;
      }
      return { challenge, difficulty, challengeId, expiresAt, version, baseUrl: host };
    } catch (e) {
      lastError = e instanceof Error ? e.message : "Unknown error";
      continue;
    }
  }

  throw new Error(
    `FreeGPT challenge failed on all hosts (${lastError}). The API may be temporarily blocked from this server. Try a different provider or retry later.`,
  );
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
      choices?: Array<{
        delta?: {
          content?: string;
          tool_calls?: Array<{
            index: number;
            id?: string;
            type?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
        finish_reason?: string;
      }>;
    };
    const choice = json?.choices?.[0];
    if (!choice) return null;

    // Handle content deltas
    const content = choice.delta?.content;
    if (typeof content === "string" && content) return content;

    // Handle tool_calls deltas — convert to text that the gateway can parse
    const toolCalls = choice.delta?.tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      // Format tool calls as a JSON envelope that the gateway's parseToolCalls can parse
      const formatted = toolCalls.map((tc) => ({
        name: tc.function?.name || "",
        arguments: tc.function?.arguments || "",
      }));
      // Return the tool call as a special marker
      return JSON.stringify({ __tool_calls: formatted });
    }

    return null;
  } catch {
    return null;
  }
}

/** Extract assistant text from a non-streaming OpenAI-compatible JSON body. */
function extractNonStreamText(json: unknown): string {
  type OpenAiShape = {
    choices?: Array<{
      message?: {
        content?: string;
        tool_calls?: Array<{
          id?: string;
          type?: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
      finish_reason?: string;
    }>;
  };
  const data = json as OpenAiShape | undefined;
  const choice = data?.choices?.[0];
  if (!choice) return "";

  // If there are tool_calls, format them as a tool-call envelope
  if (choice.message?.tool_calls && choice.message.tool_calls.length > 0) {
    const calls = choice.message.tool_calls.map((tc) => ({
      name: tc.function?.name || "",
      arguments: tc.function?.arguments || "",
    }));
    return JSON.stringify({ __tool_calls: calls });
  }

  const text = choice.message?.content;
  return typeof text === "string" ? text : "";
}

// ─── Provider ─────────────────────────────────────────────────────────────

export const freeGptProvider: Provider = {
  id: "freegpt",

  async complete(req) {
    // Rate limit
    if (!rateLimitCheck(extractClientIp(req))) {
      throw new Error("FreeGPT rate limit exceeded (30 req/min). Try again shortly.");
    }

    const signer = await ensureSignerLoaded();

    // 1. Fresh UUID per request (FreeGPT custom format, NOT UUID v4)
    const uuid = makeFreeGptUuid();
    const userid = makeUserId();
    const sessionId = crypto.randomUUID();

    // 2. Fetch challenge (tries both hosts, returns working baseUrl)
    const { challenge, difficulty, challengeId, expiresAt, version, baseUrl } = await fetchChallenge(uuid);

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
    //    empty cf-turnstile-token (server allows empty for non-CF host) +
    //    FreeGPT-specific headers (userid, x-finger, x-session-id, summarize, model).
    const secureHeaders = securePayloadToHeaders(payload);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      uuid: uuid,
      userid: userid,
      "x-session-id": sessionId,
      "x-finger": secureHeaders["x-secure-fingerprint"] || "",
      model: req.model.upstream,
      summarize: "false",
      "x-secure-challenge": challenge,
      "x-secure-challenge-id": challengeId,
      "x-secure-challenge-expires-at": String(expiresAt),
      "x-secure-challenge-version": version,
      "x-secure-client-ip": clientIp,
      "x-origin": "https://freegpt.tech",
      "cf-turnstile-token": "",
      "x-secure-timestamp": timestamp,
      "x-secure-nonce": nonce,
      "x-secure-version": "3.0",
      ...secureHeaders,
    };

    // 5. POST completion (non-streaming) — use the baseUrl from challenge
    const body: Record<string, unknown> = {
      model: req.model.upstream,
      messages: req.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: false,
      temperature: 1,
      presence_penalty: 0,
      frequency_penalty: 0,
      top_p: 1,
      max_completion_tokens: 16000,
    };

    // Pass through tools if provided (FreeGPT supports native tool calling)
    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools;
      body.tool_choice = req.toolChoice || "auto";
    }

    const res = await fetch(`${baseUrl}${COMPLETIONS_PATH}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: req.signal,
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      // 403 Forbidden — challenge endpoint blocked (nginx/Cloudflare)
      if (res.status === 403) {
        throw new Error(
          "FreeGPT challenge endpoint is currently blocked (HTTP 403). This is a server-side restriction that cannot be bypassed. Please try a different model or provider.",
        );
      }
      // Bypass for FreeGPT 400 "no available tokens" error — surface a clear,
      // actionable message instead of the raw Chinese error.
      if (res.status === 400 && txt.includes("没有可用的tokens")) {
        throw new Error(
          "FreeGPT's upstream token pool is temporarily exhausted. Please try a different model or retry in a few minutes.",
        );
      }
      if (res.status === 400 && txt.includes("Provider failed")) {
        throw new Error(
          `FreeGPT upstream provider error: ${txt.slice(0, 150)}. Try a different model or retry shortly.`,
        );
      }
      if (res.status === 401 && txt.includes("订阅")) {
        throw new Error(
          `This FreeGPT model requires a subscription. Try a different model — the free-tier models (gpt-4o-mini, gpt-5.4-mini, gpt-5.4-nano, deepseek-chat, etc.) work without subscription.`,
        );
      }
      throw new Error(
        `FreeGPT returned HTTP ${res.status}: ${txt.slice(0, 200)} | challenge=${challengeId?.slice(0,8)} exp=${expiresAt} sig=${secureHeaders['x-secure-signature']?.slice(0,12)} fp=${secureHeaders['x-secure-fingerprint']} pow=${secureHeaders['x-secure-pow-hash']?.slice(0,8)}`,
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
      throw new Error("FreeGPT rate limit exceeded (30 req/min). Try again shortly.");
    }

    const signer = await ensureSignerLoaded();

    // 1. Fresh UUID per request (FreeGPT custom format, NOT UUID v4)
    const uuid = makeFreeGptUuid();
    const userid = makeUserId();
    const sessionId = crypto.randomUUID();

    // 2. Fetch challenge (tries both hosts, returns working baseUrl)
    const { challenge, difficulty, challengeId, expiresAt, version, baseUrl } = await fetchChallenge(uuid);

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
      uuid: uuid,
      userid: userid,
      "x-session-id": sessionId,
      "x-finger": secureHeaders["x-secure-fingerprint"] || "",
      model: req.model.upstream,
      summarize: "false",
      "x-secure-challenge": challenge,
      "x-secure-challenge-id": challengeId,
      "x-secure-challenge-expires-at": String(expiresAt),
      "x-secure-challenge-version": version,
      "x-secure-client-ip": clientIp,
      "x-origin": "https://freegpt.tech",
      "cf-turnstile-token": "",
      "x-secure-timestamp": timestamp,
      "x-secure-nonce": nonce,
      "x-secure-version": "3.0",
      ...secureHeaders,
    };

    // 5. POST completion (streaming)
    const body: Record<string, unknown> = {
      model: req.model.upstream,
      messages: req.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: true,
      temperature: 1,
      presence_penalty: 0,
      frequency_penalty: 0,
      top_p: 1,
      max_completion_tokens: 16000,
    };

    // Pass through tools if provided (FreeGPT supports native tool calling)
    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools;
      body.tool_choice = req.toolChoice || "auto";
    }

    const res = await fetch(`${baseUrl}${COMPLETIONS_PATH}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: req.signal,
    });

    if (!res.ok || !res.body) {
      const txt = await res.text().catch(() => "");
      // 403 Forbidden — challenge endpoint blocked
      if (res.status === 403) {
        throw new Error(
          "FreeGPT challenge endpoint is currently blocked (HTTP 403). This is a server-side restriction that cannot be bypassed. Please try a different model or provider.",
        );
      }
      if (res.status === 400 && txt.includes("没有可用的tokens")) {
        throw new Error(
          "FreeGPT's upstream token pool is temporarily exhausted. Please try a different model or retry in a few minutes.",
        );
      }
      if (res.status === 400 && txt.includes("Provider failed")) {
        throw new Error(
          `FreeGPT upstream provider error: ${txt.slice(0, 150)}. Try a different model or retry shortly.`,
        );
      }
      if (res.status === 401 && txt.includes("订阅")) {
        throw new Error(
          `This FreeGPT model requires a subscription. Try a different model — the free-tier models (gpt-4o-mini, gpt-5.4-mini, gpt-5.4-nano, deepseek-chat, etc.) work without subscription.`,
        );
      }
      throw new Error(
        `FreeGPT returned HTTP ${res.status}: ${txt.slice(0, 200)} | challenge=${challengeId?.slice(0,8)} exp=${expiresAt} sig=${secureHeaders['x-secure-signature']?.slice(0,12)} fp=${secureHeaders['x-secure-fingerprint']} pow=${secureHeaders['x-secure-pow-hash']?.slice(0,8)}`,
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

/**
 * FreeGPT.tech provider — WASM challenge solver + curl transport.
 *
 * Each request goes through a proof-of-work challenge handshake:
 *   1. Generate a fresh UUID (per-request identity, custom format like
 *      R526072895DLHQJQ38S9SCHY8 — NOT UUID v4).
 *   2. GET /api/challenge with the uuid → server returns a challenge +
 *      difficulty level. (via curl to bypass Cloudflare TLS fingerprinting)
 *   3. Run the WASM signer (src/lib/freegpt-signer.cjs, loaded from
 *      wasm_signer_bg.wasm) to compute the secure payload (signature,
 *      nonce, timestamp) bound to (uuid, challenge, clientIp, difficulty).
 *   4. POST /api/openai/oneapi/v1/chat/completions with all x-secure-*
 *      headers (via curl to bypass Cloudflare TLS fingerprinting).
 *   5. Parse the OpenAI-format response — streaming (SSE) or non-streaming
 *      (JSON).
 *
 * HTTP transport uses curl (child_process) to bypass Cloudflare's TLS
 * fingerprinting which blocks Node.js native fetch() with 403.
 *
 * Challenges are single-use and valid for ~5 minutes, so we mint a new
 * one for every request — never reused.
 *
 * Rate limit: 30 requests/minute per client IP (best-effort, in-memory).
 */

import type { Provider, ProviderCompletionRequest } from "./types";
import {
  GatewayError,
  classifyUpstreamStatus,
} from "@/lib/gateway/errors";
import { canonicalModelId } from "@/lib/gateway/ids";
import { assertToolsForwarded } from "@/lib/tools/forwarding";

const BASE_URL = "https://freegpt.tech";
const CHALLENGE_PATH = "/api/challenge";
const COMPLETIONS_PATH = "/api/openai/oneapi/v1/chat/completions";

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
 * Lazily load + initialise the WASM signer on first use.
 * Uses eval("require") to hide from webpack/Turbopack static analysis.
 */
async function ensureSignerLoaded(): Promise<SignerModule> {
  if (signerLoaded && signerModule) return signerModule;
  if (!signerLoadPromise) {
    signerLoadPromise = (async () => {
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

// ─── curl-based HTTP transport ────────────────────────────────────────────

/**
 * Make an HTTP GET request using curl (bypasses Cloudflare TLS fingerprinting).
 * Returns the response body as a string.
 */
async function curlGet(url: string, headers: Record<string, string>): Promise<string> {
  const cp = await import("node:child_process");
  const args = ["-s", "-S", "--max-time", "15"];
  for (const [k, v] of Object.entries(headers)) {
    args.push("-H", `${k}: ${v}`);
  }
  args.push(url);

  return new Promise((resolve, reject) => {
    const proc = cp.spawn("curl", args, { timeout: 20000 });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("close", (code: number) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`curl GET ${url} exited ${code}: ${stderr.slice(0, 200)}`));
    });
    proc.on("error", (err: Error) => reject(err));
  });
}

/**
 * Make an HTTP POST request using curl. Returns { status, body }.
 */
async function curlPost(
  url: string,
  headers: Record<string, string>,
  body: string,
): Promise<{ status: number; body: string }> {
  const cp = await import("node:child_process");
  const args = ["-s", "-S", "--max-time", "120", "-w", "\n__HTTP_STATUS__%{http_code}", "-d", body];
  for (const [k, v] of Object.entries(headers)) {
    args.push("-H", `${k}: ${v}`);
  }
  args.push(url);

  return new Promise((resolve, reject) => {
    const proc = cp.spawn("curl", args, { timeout: 130000 });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("close", (code: number) => {
      if (code !== 0 && !stdout) {
        reject(new Error(`curl POST ${url} exited ${code}: ${stderr.slice(0, 200)}`));
        return;
      }
      // Extract status from the __HTTP_STATUS__ marker
      const marker = "__HTTP_STATUS__";
      const markerIdx = stdout.lastIndexOf(marker);
      if (markerIdx >= 0) {
        const statusStr = stdout.slice(markerIdx + marker.length).trim();
        const status = parseInt(statusStr, 10) || 0;
        const responseBody = stdout.slice(0, markerIdx);
        resolve({ status, body: responseBody });
      } else {
        resolve({ status: 0, body: stdout });
      }
    });
    proc.on("error", (err: Error) => reject(err));
  });
}

// ─── Simple in-memory rate limiter ────────────────────────────────────────
interface RateBucket {
  count: number;
  windowStart: number;
}
const rateBuckets = new Map<string, RateBucket>();

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

function makeNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

function makeFreeGptUuid(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => chars[b % chars.length]).join("");
}

function makeUserId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => chars[b % chars.length]).join("");
}

function extractClientIp(_req: ProviderCompletionRequest): string {
  return "127.0.0.1";
}

const CHALLENGE_HEADERS = {
  Accept: "application/json",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  Referer: "https://freegpt.tech/",
  "Accept-Language": "en-US,en;q=0.9",
  "x-origin": "https://freegpt.tech",
};

/**
 * Fetch a fresh challenge for the given uuid via curl.
 * Returns the challenge string, difficulty, and metadata.
 */
async function fetchChallenge(uuid: string): Promise<{
  challenge: string;
  difficulty: number;
  challengeId: string;
  expiresAt: number;
  version: string;
}> {
  const headers = { ...CHALLENGE_HEADERS, uuid };

  try {
    const body = await curlGet(`${BASE_URL}${CHALLENGE_PATH}`, headers);
    const json = JSON.parse(body) as Record<string, unknown>;
    const challenge =
      (json.challenge as string) ??
      (json.token as string) ??
      (json.challenge_token as string) ??
      "";
    const difficulty = (json.difficulty as number) ?? (json.level as number) ?? 2;
    const challengeId = (json.challengeId as string) ?? "";
    const expiresAt = (json.expiresAt as number) ?? 0;
    const version = (json.version as string) ?? "1.0";
    if (!challenge || !challengeId) {
      throw new Error(`Unexpected challenge response: ${body.slice(0, 200)}`);
    }
    return { challenge, difficulty, challengeId, expiresAt, version };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    throw new Error(
      `FreeGPT challenge fetch failed: ${msg}. Try a different provider or retry later.`,
    );
  }
}

/**
 * Convert the secure-payload object into a flat HTTP header map.
 * Flattens nested objects with `-` separator and snake_case → kebab-case,
 * then prefixes every key with `x-secure-`.
 */
function securePayloadToHeaders(payload: Record<string, unknown> | string): Record<string, string> {
  let obj: Record<string, unknown>;
  if (typeof payload === "string") {
    try {
      obj = JSON.parse(payload) as Record<string, unknown>;
    } catch {
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

    const content = choice.delta?.content;
    if (typeof content === "string" && content) return content;

    const toolCalls = choice.delta?.tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      const formatted = toolCalls.map((tc) => ({
        name: tc.function?.name || "",
        arguments: tc.function?.arguments || "",
      }));
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
    if (!rateLimitCheck(extractClientIp(req))) {
      throw new Error("FreeGPT rate limit exceeded (30 req/min). Try again shortly.");
    }

    const signer = await ensureSignerLoaded();

    const uuid = makeFreeGptUuid();
    const userid = makeUserId();
    const sessionId = crypto.randomUUID();

    // Fetch challenge via curl (bypasses Cloudflare)
    const { challenge, difficulty, challengeId, expiresAt, version } = await fetchChallenge(uuid);

    // Generate secure payload via WASM signer
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

    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools;
      body.tool_choice = req.toolChoice ?? "auto";
    }
    if (req.parallelToolCalls !== undefined) {
      body.parallel_tool_calls = req.parallelToolCalls;
    }
    // Tool PRD §20 — prove tools survived into the provider payload.
    assertToolsForwarded(body, req.tools, "freegpt", req.model.upstream);

    // POST via curl
    const url = `${BASE_URL}${COMPLETIONS_PATH}`;
    const { status, body: resBody } = await curlPost(url, headers, JSON.stringify(body));

    if (status !== 200) {
      const txt = resBody.slice(0, 500);
      const ctx = {
        provider: "freegpt" as const,
        model: req.model.upstream,
      };
      // 403 → PROVIDER_UNAVAILABLE (NOT retried — PRD §63, §148).
      if (status === 403) {
        throw classifyUpstreamStatus(403, { ...ctx, body: txt });
      }
      // 400 token-pool exhausted → PROVIDER_UNAVAILABLE (upstream side, not retryable here).
      if (status === 400 && txt.includes("没有可用的tokens")) {
        throw new GatewayError({
          type: "PROVIDER_UNAVAILABLE",
          message:
            "FreeGPT's upstream token pool is temporarily exhausted. Try a different model or retry in a few minutes.",
          status: 502,
          upstreamStatus: 400,
          provider: "freegpt",
          model: canonicalModelId("freegpt", req.model.upstream),
        });
      }
      // 400 upstream provider failure → PROVIDER_UNAVAILABLE.
      if (status === 400 && txt.includes("Provider failed")) {
        throw new GatewayError({
          type: "PROVIDER_UNAVAILABLE",
          message: `FreeGPT upstream provider error: ${txt.slice(0, 150)}. Try a different model or retry shortly.`,
          status: 502,
          upstreamStatus: 400,
          provider: "freegpt",
          model: canonicalModelId("freegpt", req.model.upstream),
        });
      }
      // 401 subscription required → AUTHENTICATION_REQUIRED.
      if (status === 401 && txt.includes("订阅")) {
        throw new GatewayError({
          type: "AUTHENTICATION_REQUIRED",
          message:
            "This FreeGPT model requires a subscription. Try a different model — the free-tier models work without subscription.",
          status: 401,
          upstreamStatus: 401,
          provider: "freegpt",
          model: canonicalModelId("freegpt", req.model.upstream),
        });
      }
      // Fallback: classify by status code (4xx → UPSTREAM_4XX, 5xx → UPSTREAM_5XX, etc.).
      throw classifyUpstreamStatus(status, { ...ctx, body: txt });
    }

    const json = JSON.parse(resBody) as unknown;
    const text = extractNonStreamText(json);
    if (!text) {
      throw new Error(
        `FreeGPT response missing choices[0].message.content: ${resBody.slice(0, 200)}`,
      );
    }
    return { text };
  },

  async *stream(req) {
    if (!rateLimitCheck(extractClientIp(req))) {
      throw new Error("FreeGPT rate limit exceeded (30 req/min). Try again shortly.");
    }

    const signer = await ensureSignerLoaded();

    const uuid = makeFreeGptUuid();
    const userid = makeUserId();
    const sessionId = crypto.randomUUID();

    // Fetch challenge via curl (bypasses Cloudflare)
    const { challenge, difficulty, challengeId, expiresAt, version } = await fetchChallenge(uuid);

    // Generate secure payload via WASM signer
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

    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools;
      body.tool_choice = req.toolChoice ?? "auto";
    }
    if (req.parallelToolCalls !== undefined) {
      body.parallel_tool_calls = req.parallelToolCalls;
    }
    // Tool PRD §20 — prove tools survived into the provider payload.
    assertToolsForwarded(body, req.tools, "freegpt", req.model.upstream);

    // POST via curl for streaming. Add `-w "\n__HTTP_STATUS__%{http_code}"` so
    // we can detect upstream HTTP status (esp. 403 Cloudflare blocks) instead
    // of silently parsing the HTML error page as zero SSE deltas (PRD §148).
    // Keep `-N` for no-buffering so genuine streaming is preserved (PRD §137).
    const cp = await import("node:child_process");
    const url = `${BASE_URL}${COMPLETIONS_PATH}`;
    const curlArgs = [
      "-s",
      "-S",
      "-N",
      "--max-time",
      "120",
      "-w",
      "\n__HTTP_STATUS__%{http_code}",
      "-d",
      JSON.stringify(body),
    ];
    for (const [k, v] of Object.entries(headers)) {
      curlArgs.push("-H", `${k}: ${v}`);
    }
    curlArgs.push(url);

    const proc = cp.spawn("curl", curlArgs, { timeout: 130000 });

    const STATUS_MARKER = "__HTTP_STATUS__";

    let buffer = "";
    let firstChunk = true;
    let errorDetected = false;
    let firstChunkPreview = "";
    let httpStatus: number | null = null;

    try {
      for await (const chunk of proc.stdout as AsyncIterable<Buffer>) {
        const text = chunk.toString();
        buffer += text;

        // Extract status marker if present (curl writes it at end-of-stream;
        // lastIndexOf on the buffer handles markers split across chunks).
        const markerIdx = buffer.lastIndexOf(STATUS_MARKER);
        if (markerIdx >= 0) {
          const after = buffer.slice(markerIdx + STATUS_MARKER.length);
          const codeMatch = after.match(/^\s*(\d{3})/);
          if (codeMatch) {
            httpStatus = parseInt(codeMatch[1], 10);
          }
          // Strip the marker (and any trailing status text) from the SSE buffer.
          buffer = buffer.slice(0, markerIdx);
        }

        // If non-200 status has already been observed via the marker, throw
        // BEFORE yielding any further SSE delta (PRD §148).
        if (httpStatus !== null && httpStatus !== 200) {
          throw classifyUpstreamStatus(httpStatus, {
            provider: "freegpt",
            model: req.model.upstream,
            body: firstChunkPreview || buffer.slice(0, 240),
          });
        }

        // First-chunk error-page detection (BEFORE yielding any delta).
        if (firstChunk && buffer.trim()) {
          firstChunk = false;
          firstChunkPreview = buffer.trim().slice(0, 240);
          const lower = firstChunkPreview.toLowerCase();
          // HTML / Cloudflare block page → throw structured 403 immediately.
          if (
            firstChunkPreview.startsWith("<!") ||
            firstChunkPreview.startsWith("<html") ||
            lower.includes("<!doctype") ||
            lower.includes("cloudflare") ||
            lower.includes("cf-ray") ||
            lower.includes("cf-mitigated") ||
            lower.includes("access denied")
          ) {
            throw classifyUpstreamStatus(httpStatus ?? 403, {
              provider: "freegpt",
              model: req.model.upstream,
              body: firstChunkPreview,
            });
          }
          // JSON error response (e.g. {"error":{...}}) → accumulate + throw at end.
          if (firstChunkPreview.includes('"error"')) {
            errorDetected = true;
            continue;
          }
        }

        if (errorDetected) {
          // Accumulate the full error body for end-of-stream parsing.
          continue;
        }

        // Genuine streaming: parse SSE lines as they arrive (PRD §10, §137).
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const delta = parseOpenAISseLine(line);
          if (delta) yield delta;
        }
      }

      // ── End of stream — finalize error detection ──

      if (errorDetected) {
        // Try to parse the accumulated body as an OpenAI-shaped JSON error.
        let errMsg = buffer.slice(0, 240);
        try {
          const errJson = JSON.parse(buffer) as {
            error?: { message?: string };
          };
          if (errJson.error?.message) errMsg = errJson.error.message;
        } catch {
          // not JSON — use raw preview
        }
        const status = httpStatus && httpStatus !== 200 ? httpStatus : 400;
        throw classifyUpstreamStatus(status, {
          provider: "freegpt",
          model: req.model.upstream,
          body: errMsg,
        });
      }

      // Non-200 detected via marker (e.g. empty 4xx/5xx body).
      if (httpStatus !== null && httpStatus !== 200) {
        throw classifyUpstreamStatus(httpStatus, {
          provider: "freegpt",
          model: req.model.upstream,
          body: firstChunkPreview || buffer.slice(0, 240),
        });
      }

      // Flush any remaining SSE buffer.
      const delta = parseOpenAISseLine(buffer);
      if (delta) yield delta;
    } finally {
      proc.kill();
    }
  },
};

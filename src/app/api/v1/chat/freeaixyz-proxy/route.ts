/**
 * FreeAIXYZ proxy route — Node.js runtime.
 *
 * Cloudflare blocks Node.js native fetch due to TLS fingerprinting.
 * We use curl via child_process as a workaround.
 *
 * Body: { model, messages, stream, tools?, toolChoice? }
 * Response: OpenAI-compatible JSON or SSE stream
 *
 * R-1: empty-content validation runs BEFORE the stream is opened — empty
 * user content returns 400 invalid_request_error instead of leaking the
 * upstream cache-writer error string to the client.
 * R-2: mid-stream errors emit `event: error` + a terminal `data:` chunk
 * with `finish_reason: "error"` + `[DONE]` so `Status: N/A` clients can
 * detect the failure.
 * R-4: response headers never include `content-encoding` (the body is
 * plain JSON / SSE; inheriting a stale br header breaks spec-compliant
 * HTTP clients like aiohttp/httpx).
 * R-5: empty upstream content is surfaced as 502 `empty_upstream_response`
 * rather than a silent 200 + `content:""` + `finish_reason:"stop"`.
 */

import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import { resolveGatewayModel } from "@/lib/providers/registry";
import { generateCompletionId, generateToolCallId, estimateTokens, type OAIToolCall } from "@/lib/openai-types";
import { parseToolCalls } from "@/lib/tool-calls";
import type { ProviderTool } from "@/lib/providers/types";
import {
  GatewayError,
  emptyContentError,
  emptyUpstreamResponseError,
  hasNonEmptyContent,
  sseErrorEvent,
  sseTerminalErrorChunk,
} from "@/lib/gateway/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const AJAX_URL = "https://unlimitedai.org/wp-admin/admin-ajax.php";
const CHAT_URL = "https://unlimitedai.org/chat/?uai_mode=chat&uai_model=claude";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const BOT_IDS: Record<string, string> = {
  chatgpt: "25871", gemini: "25874", deepseek: "25873", claude: "25875",
  grok: "25872", perplexity: "29624", meta: "25870", qwen: "25869",
};

/**
 * R-4: SSE response headers that intentionally OMIT `content-encoding` and
 * `transfer-encoding` — the body is plain UTF-8, never brotli-compressed.
 * Inheriting a stale `content-encoding: br` header (BUG-2) breaks every
 * spec-compliant HTTP client.
 */
const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-store, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
  "X-No-Buffer": "true",
};

/** JSON response helper that NEVER sets content-encoding (R-4). */
function jsonNoEncoding(body: unknown, status = 200, extra?: Record<string, string>): NextResponse {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (extra) Object.assign(headers, extra);
  return NextResponse.json(body, { status, headers });
}

/** JSON error helper that returns the gateway error shape (R-1, R-5, R-7). */
function gatewayErrorResponse(err: GatewayError): NextResponse {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (err.type === "RATE_LIMITED") {
    headers["Retry-After"] = String(err.retryAfter ?? 60);
  }
  return new NextResponse(JSON.stringify({ error: err.toJSON() }), {
    status: err.status,
    headers,
  });
}

// ─── curl helpers (bypass Cloudflare TLS fingerprinting) ──────────────────

function curlGet(url: string, timeout = 10): string {
  return execSync(`curl -s --max-time ${timeout} -H "User-Agent: ${UA}" "${url}"`, {
    encoding: "utf8", timeout: (timeout + 2) * 1000, maxBuffer: 10 * 1024 * 1024,
  });
}

function curlPostForm(url: string, data: string, timeout = 10): string {
  const escapedData = data.replace(/"/g, '\\"').replace(/`/g, "\\`");
  return execSync(
    `curl -s --max-time ${timeout} -X POST -H "User-Agent: ${UA}" -H "Referer: ${CHAT_URL}" -H "Origin: https://unlimitedai.org" -H "Content-Type: application/x-www-form-urlencoded" --data-binary "${escapedData}" "${url}"`,
    { encoding: "utf8", timeout: (timeout + 2) * 1000, maxBuffer: 10 * 1024 * 1024 },
  );
}

// ─── Nonce cache ──────────────────────────────────────────────────────────

let cachedNonce: string | null = null;
let lastCacheTime = 0;

function getLiveChatNonce(): string {
  const now = Date.now();
  if (cachedNonce && now - lastCacheTime < 10 * 60 * 1000) return cachedNonce;
  try {
    const html = curlGet(CHAT_URL, 15);
    const match = html.match(/&quot;nonce&quot;\s*:\s*&quot;([a-zA-Z0-9]+)&quot;/i) || html.match(/"nonce"\s*:\s*"([a-zA-Z0-9]+)"/i);
    if (match?.[1]) { cachedNonce = match[1]; lastCacheTime = now; return cachedNonce; }
  } catch (e) { console.error("Nonce fetch failed:", e); }
  return cachedNonce || "a2ff06d039";
}

function invalidateNonce() { cachedNonce = null; lastCacheTime = 0; }

// ─── UUID ─────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function ensureUuid(v?: string): string { return (v && UUID_RE.test(v)) ? v : crypto.randomUUID(); }

// ─── Stream from UnlimitedAI ──────────────────────────────────────────────

async function* streamFromUpstream(
  modelUpstream: string,
  messages: Array<{ role: string; content: string }>,
): AsyncGenerator<string, void, unknown> {
  const baseKey = modelUpstream.replace(/-search$/, "");
  const botId = BOT_IDS[baseKey];
  if (!botId) throw new Error(`FreeAIXYZ: unknown model "${modelUpstream}"`);

  const wantsWebSearch = modelUpstream.endsWith("-search");
  const lastUser = messages.filter((m) => m.role === "user").pop();
  if (!lastUser) throw new Error("FreeAIXYZ: no user message");
  const prompt = lastUser.content;

  const convUuid = ensureUuid();
  const sessionId = ensureUuid();
  let nonce = getLiveChatNonce();

  // Step 1: Cache
  const fd = new URLSearchParams();
  fd.append("action", "aipkit_cache_sse_message");
  fd.append("message", prompt);
  fd.append("_ajax_nonce", nonce);
  fd.append("bot_id", botId);
  fd.append("session_id", sessionId);
  fd.append("conversation_uuid", convUuid);

  // Vision
  const imgs: Array<{ type: string; image_url: { url: string } }> = [];
  for (const m of messages) {
    if (typeof m.content === "string" && m.content.includes("data:image")) {
      const matches = m.content.match(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g);
      if (matches) for (const u of matches) imgs.push({ type: "image_url", image_url: { url: u } });
    }
  }
  if (imgs.length > 0) fd.append("image_inputs", JSON.stringify(imgs));

  let cacheJson: { success?: boolean; data?: { cache_key?: string; message?: string } };
  try {
    const cacheRes = curlPostForm(AJAX_URL, fd.toString(), 10);
    cacheJson = JSON.parse(cacheRes);
  } catch {
    // Retry with fresh nonce
    invalidateNonce();
    nonce = getLiveChatNonce();
    fd.set("_ajax_nonce", nonce);
    const retryRes = curlPostForm(AJAX_URL, fd.toString(), 10);
    try { cacheJson = JSON.parse(retryRes); } catch { throw new Error("FreeAIXYZ: cache POST failed"); }
  }

  if (!cacheJson?.success) {
    // Retry once more
    invalidateNonce();
    nonce = getLiveChatNonce();
    fd.set("_ajax_nonce", nonce);
    const retryRes = curlPostForm(AJAX_URL, fd.toString(), 10);
    try { cacheJson = JSON.parse(retryRes); } catch { throw new Error("FreeAIXYZ: cache rejected"); }
    if (!cacheJson?.success) throw new Error(cacheJson?.data?.message || "FreeAIXYZ: cache rejected");
  }

  const cacheKey = cacheJson.data?.cache_key;
  if (!cacheKey) throw new Error("FreeAIXYZ: no cache_key");

  // Step 2: SSE stream via curl spawn
  let params = `action=aipkit_frontend_chat_stream&cache_key=${cacheKey}&bot_id=${botId}&session_id=${sessionId}&conversation_uuid=${convUuid}&_ajax_nonce=${nonce}&_ts=${Date.now()}`;
  if (wantsWebSearch) params += "&frontend_web_search_active=true";
  const sseUrl = `${AJAX_URL}?${params}`;

  const { spawn } = require("child_process") as typeof import("child_process");
  const proc = spawn("curl", ["-s", "-N", "--max-time", "120", "-H", `User-Agent: ${UA}`, "-H", `Referer: ${CHAT_URL}`, "-H", "Origin: https://unlimitedai.org", "-H", "Accept: text/event-stream", sseUrl]);

  let buf = "";
  for await (const chunk of proc.stdout) {
    buf += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      const t = line.trim();
      if (!t || !t.startsWith("data:")) continue;
      const raw = t.substring(5).trim();
      if (raw === "[DONE]" || raw.includes('"finished":true')) continue;
      try {
        const p = JSON.parse(raw);
        if (typeof p.delta === "string" && p.delta) yield p.delta;
        else if (typeof p.content === "string" && p.content) yield p.content;
        else if (typeof p.text === "string" && p.text) yield p.text;
        else if (Array.isArray(p.choices) && p.choices[0]?.delta?.content) yield p.choices[0].delta.content;
      } catch {
        if (raw && raw !== "[DONE]") yield raw;
      }
    }
  }
}

// ─── Route handler ────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return gatewayErrorResponse(
      new GatewayError({
        type: "INVALID_REQUEST",
        status: 400,
        code: "invalid_request_error",
        message: "Invalid JSON body.",
      }),
    );
  }
  const model = resolveGatewayModel(body.model as string);
  const messages = (body.messages as Array<{ role: string; content: string }>) ?? [];
  const useTools = Array.isArray(body.tools) && body.tools.length > 0;
  const wantsStream = body.stream === true;

  // The chat completions route now also forwards canonical `fx/<upstreamId>`
  // ids to this proxy (the legacy adapter's fetch-based stream() is blocked
  // by Cloudflare TLS fingerprinting — curl is the only way to reach the
  // upstream). `resolveGatewayModel` only resolves legacy ids like
  // `fxyz-chatgpt`; for canonical ids we have to parse the `fx/` prefix
  // ourselves and synthesize a minimal model descriptor so the rest of the
  // route handler keeps working unchanged.
  let modelId: string;
  let modelUpstream: string;
  if (model) {
    modelId = model.id;
    modelUpstream = model.upstream;
  } else {
    const raw = String(body.model ?? "").trim();
    const slashIdx = raw.indexOf("/");
    if (slashIdx > 0) {
      modelUpstream = raw.slice(slashIdx + 1);
      modelId = raw;
    } else {
      // Unknown — surface a clean 404 so the client isn't confused.
      return gatewayErrorResponse(
        new GatewayError({
          type: "MODEL_NOT_FOUND",
          status: 404,
          message: `Model "${raw}" was not found.`,
          model: raw,
        }),
      );
    }
  }

  // R-1: validate non-empty content BEFORE the stream is opened. This is
  // the direct fix for the reported error "Data to cache (message or image)
  // cannot be empty." — the upstream cache-writer rejects empty content
  // and leaks its internal error string back to the client. Variants
  // A/E/F/G/I from the audit report all reproduce the leak; reject them
  // here with HTTP 400 invalid_request_error so the upstream never sees
  // them. Crucially, this runs BEFORE the streaming branch is chosen, so
  // BOTH streaming and non-streaming empty-content requests are rejected
  // with a real HTTP status (no more `Status: N/A` for streaming).
  if (!hasNonEmptyContent(messages)) {
    return gatewayErrorResponse(emptyContentError(modelId, "freeaixyz"));
  }

  if (wantsStream) {
    // ─── PRE-FLIGHT (R-2 TRUE FIX) ─────────────────────────────────────
    // Probe the upstream by awaiting the FIRST chunk (or first throw)
    // BEFORE opening the 200 OK SSE stream. Pre-first-token errors now
    // return a real HTTP error Response (404/502/429/401/…) with a JSON
    // body — NOT a 200 OK SSE stream with an in-band `event: error` frame
    // that the client can't classify (producing `Status: N/A`). Mid-stream
    // errors keep the existing `event: error` + terminal-chunk behavior.
    const preflight = streamFromUpstream(modelUpstream, messages);
    let firstDelta = "";
    try {
      const first = await preflight.next();
      if (first.done) {
        // Generator returned without yielding anything → empty upstream.
        try { await preflight.return(undefined); } catch { /* best-effort */ }
        return gatewayErrorResponse(
          emptyUpstreamResponseError("freeaixyz", modelId),
        );
      }
      firstDelta = first.value ?? "";
    } catch (err) {
      try { await preflight.return(undefined); } catch { /* best-effort */ }
      const msg = err instanceof Error ? err.message : "Unknown error";
      const isAuth = /\bHTTP (401|403)\b/i.test(msg) || /unauthorized|forbidden/i.test(msg);
      const isQuota = /quota|rate.?limit|429/i.test(msg);
      const ge = new GatewayError({
        type: isAuth ? "AUTHENTICATION_REQUIRED" : isQuota ? "RATE_LIMITED" : "UPSTREAM_5XX",
        status: isAuth ? 401 : isQuota ? 429 : 502,
        code: isAuth ? "authentication_required" : isQuota ? "rate_limited" : "upstream_error",
        message: isAuth
          ? "Provider requires authentication (HTTP 401)."
          : isQuota
            ? "Upstream rate limit exceeded. Retry after 60s."
            : "Upstream provider failed to generate a response.",
        upstreamDetail: msg,
        provider: "freeaixyz",
        model: modelId,
        requiresAuth: isAuth,
        retryAfter: isQuota ? 60 : undefined,
      });
      return gatewayErrorResponse(ge);
    }

    // ─── PRE-FLIGHT SUCCEEDED → open 200 OK SSE stream ──────────────────
    const encoder = new TextEncoder();
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const id = generateCompletionId();
    const created = Math.floor(Date.now() / 1000);
    const send = (obj: unknown) => writer.write(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
    // R-2 mid-stream: helper that emits an SSE error event + terminal chunk
    // with finish_reason:"error" + [DONE] before closing the writer. Used
    // only when the upstream throws AFTER at least one content chunk has
    // been forwarded (pre-first-token throws were caught by the pre-flight
    // above and converted to a real HTTP error Response).
    const sendStreamError = (err: GatewayError) => {
      try {
        writer.write(encoder.encode(sseErrorEvent(err)));
        writer.write(encoder.encode(sseTerminalErrorChunk(err, id, created, modelId)));
      } catch {
        // best-effort
      }
    };

    (async () => {
      let hadError = false;
      try {
        await send({ id, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });

        if (useTools) {
          // firstDelta is already in hand from the pre-flight; accumulate
          // the rest from the (already-opened) generator.
          let fullText = firstDelta;
          for await (const delta of preflight) { if (delta) fullText += delta; }
          const parsed = parseToolCalls(fullText, generateToolCallId);
          if (parsed.toolCalls.length > 0) {
            for (let i = 0; i < parsed.toolCalls.length; i++) {
              const tc: OAIToolCall = parsed.toolCalls[i];
              await send({ id, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta: { tool_calls: [{ index: i, id: tc.id, type: "function", function: { name: tc.function.name, arguments: tc.function.arguments } }] }, finish_reason: null }] });
            }
            await send({ id, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
          } else {
            // R-5: empty content (no tool calls extracted + no full text)
            // surfaces as a mid-stream event:error + terminal chunk (the
            // stream is already open over 200 OK, so we can't promote it
            // to a real HTTP status — the pre-flight already succeeded).
            const content = (parsed.text || fullText).trim();
            if (!content) {
              hadError = true;
              sendStreamError(emptyUpstreamResponseError("freeaixyz", modelId));
              return;
            }
            const tokens = (parsed.text || fullText).match(/(\s+|\S+)/g) ?? [parsed.text || fullText];
            for (const t of tokens) await send({ id, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta: { content: t }, finish_reason: null }] });
            await send({ id, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
          }
        } else {
          // Forward each upstream delta immediately. firstDelta is already
          // in hand from the pre-flight — emit it now, then continue pulling
          // from the (already-opened) generator.
          let hasContent = false;
          if (firstDelta) {
            hasContent = true;
            await send({ id, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta: { content: firstDelta }, finish_reason: null }] });
          }
          for await (const delta of preflight) {
            if (delta) {
              hasContent = true;
              await send({ id, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta: { content: delta }, finish_reason: null }] });
            }
          }
          // R-5: refuse to silently pass on an empty stream. Emit the
          // error event + terminal chunk so SSE clients can detect the
          // failure (BUG-3 — silent empty successes).
          if (!hasContent) {
            hadError = true;
            sendStreamError(emptyUpstreamResponseError("freeaixyz", modelId));
            return;
          }
          await send({ id, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
        }
      } catch (err) {
        hadError = true;
        const msg = err instanceof Error ? err.message : "Unknown error";
        // R-2 mid-stream + R-7 + R-10: classify + sanitize the upstream
        // error, then emit it as an SSE error event + terminal chunk. The
        // top-level `http_status` field on the SSE error frame carries the
        // real HTTP status that would have been returned for non-streaming.
        const isAuth = /\bHTTP (401|403)\b/i.test(msg) || /unauthorized|forbidden/i.test(msg);
        const isQuota = /quota|rate.?limit|429/i.test(msg);
        const ge = new GatewayError({
          type: isAuth ? "AUTHENTICATION_REQUIRED" : isQuota ? "RATE_LIMITED" : "UPSTREAM_5XX",
          status: isAuth ? 401 : isQuota ? 429 : 502,
          code: isAuth ? "authentication_required" : isQuota ? "rate_limited" : "upstream_error",
          message: isAuth
            ? "Provider requires authentication (HTTP 401)."
            : isQuota
              ? "Upstream rate limit exceeded. Retry after 60s."
              : "Upstream provider failed to generate a response.",
          upstreamDetail: msg,
          provider: "freeaixyz",
          model: modelId,
          requiresAuth: isAuth,
          retryAfter: isQuota ? 60 : undefined,
        });
        sendStreamError(ge);
      } finally {
        // R-2: always close with [DONE] so clients waiting on the sentinel
        // are released (best-effort — the terminal chunk already includes
        // its own [DONE] when an error occurred).
        if (!hadError) {
          try { await writer.write(encoder.encode("data: [DONE]\n\n")); } catch {}
        }
        try { await writer.close(); } catch {}
      }
    })();

    // R-4: SSE_HEADERS intentionally omits content-encoding + transfer-encoding.
    return new Response(readable, { headers: SSE_HEADERS });
  }

  // Non-streaming
  try {
    let text = "";
    for await (const delta of streamFromUpstream(modelUpstream, messages)) { text += delta; }
    // R-5: refuse to silently pass on an empty reply.
    if (!text.trim()) {
      return gatewayErrorResponse(emptyUpstreamResponseError("freeaixyz", modelId));
    }
    if (useTools) {
      const parsed = parseToolCalls(text, generateToolCallId);
      if (parsed.toolCalls.length > 0) return jsonNoEncoding({ id: generateCompletionId(), object: "chat.completion", created: Math.floor(Date.now() / 1000), model: modelId, choices: [{ index: 0, message: { role: "assistant", content: parsed.text || null, tool_calls: parsed.toolCalls }, finish_reason: "tool_calls" }], usage: { prompt_tokens: estimateTokens(messages.map((m) => m.content).join("\n")), completion_tokens: estimateTokens(text), total_tokens: estimateTokens(messages.map((m) => m.content).join("\n")) + estimateTokens(text) } });
    }
    return jsonNoEncoding({ id: generateCompletionId(), object: "chat.completion", created: Math.floor(Date.now() / 1000), model: modelId, choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }], usage: { prompt_tokens: estimateTokens(messages.map((m) => m.content).join("\n")), completion_tokens: estimateTokens(text), total_tokens: estimateTokens(messages.map((m) => m.content).join("\n")) + estimateTokens(text) } });
  } catch (err) {
    // R-7 + R-10: classify + sanitize the upstream error.
    const msg = err instanceof Error ? err.message : "Unknown error";
    const isAuth = /\bHTTP (401|403)\b/i.test(msg) || /unauthorized|forbidden/i.test(msg);
    const isQuota = /quota|rate.?limit|429/i.test(msg);
    const ge = new GatewayError({
      type: isAuth ? "AUTHENTICATION_REQUIRED" : isQuota ? "RATE_LIMITED" : "UPSTREAM_5XX",
      status: isAuth ? 401 : isQuota ? 429 : 502,
      code: isAuth ? "authentication_required" : isQuota ? "rate_limited" : "upstream_error",
      message: isAuth
        ? "Provider requires authentication (HTTP 401)."
        : isQuota
          ? "Upstream rate limit exceeded. Retry after 60s."
          : "Upstream provider failed to generate a response.",
      upstreamDetail: msg,
      provider: "freeaixyz",
      model: modelId,
      requiresAuth: isAuth,
      retryAfter: isQuota ? 60 : undefined,
    });
    return gatewayErrorResponse(ge);
  }
}

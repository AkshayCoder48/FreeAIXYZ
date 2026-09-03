/**
 * POST /api/v1/chat/completions — OpenAI-compatible chat completions.
 *
 * THE STREAMING FIX (PRD §137, §238):
 *   - Canonical ids (`fg/gpt-5`, `tb/gpt-4o`, `oc/big-pickle`) go through the
 *     NEW gateway path — `streamChat(req, adapter)` from the streaming-proxy
 *     service forwards every upstream delta immediately as an OpenAI-shaped
 *     SSE chunk. NO buffering, NO re-pacing, NO sleep, NO heartbeat.
 *   - Non-streaming providers (`capabilities.streaming=false`) get ONE
 *     content chunk + stop — honest, not fake-streamed (PRD §137).
 *   - Legacy old-style ids (`fgpt-gpt-5-5`, `oc-big-pickle`) fall back to
 *     the LEGACY path: `resolveGatewayModel` + `getProvider` + immediate
 *     delta forwarding (real-stream providers) OR one-content-chunk + stop
 *     (non-stream providers). The fake `streamText()` re-pacer has been
 *     removed entirely (PRD §137).
 *   - Legacy freegpt / freeaixyz special-proxy branch is kept for legacy
 *     ids (it still works — Phase 2b wired freegpt to throw GatewayError on
 *     403, which the proxy route surfaces).
 *
 * Error envelope (PRD §146):
 *   { error: { type, message, provider, model, request_id, code, status } }
 */

import { NextResponse } from "next/server";
import {
  resolveGatewayModel,
  getProvider,
  type GatewayModel,
  type ProviderMessage,
} from "@/lib/providers";
import type { ProviderTool } from "@/lib/providers/types";
import { ToolbazError } from "@/lib/toolbaz";
import {
  generateCompletionId,
  generateToolCallId,
  estimateTokens,
  type OAIChatCompletionRequest,
  type OAIChatCompletionResponse,
  type OAIToolCall,
  type OAIToolChoice,
} from "@/lib/openai-types";
import {
  buildToolSystemPrompt,
  messageToText,
  parseToolCalls,
  hasTools,
} from "@/lib/tool-calls";
import {
  catalogStore,
  errorResponse as gatewayErrorResponse,
  GatewayError,
  emptyContentError,
  emptyUpstreamResponseError,
  generateRequestId,
  hasNonEmptyContent,
  isFailoverCandidate,
  metricsService,
  providerHealthService,
  providerRegistry,
  parseCanonicalModelId,
  STREAM_HEADERS,
  streamChat,
  sseErrorEvent,
  sseTerminalErrorChunk,
  type ChatRequest,
  type DiscoveredModel,
  type FailoverCandidate,
  type ProviderAdapter,
} from "@/lib/gateway";
import { ensureGateway, resolveAdapterForModel } from "@/lib/gateway/route-helpers";
import {
  isNativeToolProvider,
  TOOL_AVAILABILITY_SYSTEM_PROMPT,
  validateToolParams,
  type ValidatedToolParams,
} from "@/lib/tools/validation";
import { toolDiagnostics } from "@/lib/tools/diagnostics";
import {
  imageAnnotation,
  normalizeMessageContent,
} from "@/lib/gateway/content-normalize";
import { withCors, corsPreflight } from "@/lib/api/cors";
import { isTransientUpstreamError, retryDelayMs, sleep, withRetry } from "@/lib/gateway/retry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Hop-by-hop / content-encoding headers that MUST be stripped from any
 * upstream-proxy response before passing it through to the client (R-4).
 *
 * The internal `fetch(origin + proxyRoute)` call asks for brotli/gzip
 * encoding via `Accept-Encoding`; if Vercel's fetch layer (or the proxy
 * route itself) returns `content-encoding: br` but the body is plain JSON
 * (because the proxy route built its own response and never compressed
 * it), every spec-compliant client (aiohttp/httpx) raises a decode error.
 *
 * The fix is to never inherit `content-encoding`, `content-length`, or
 * `transfer-encoding` from the internal proxy response — let the outer
 * Vercel edge re-compress as appropriate.
 */
const HOP_BY_HOP_HEADERS = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "content-encoding",
]);

/** Build a clean passthrough headers object (R-4). */
function cleanProxyHeaders(src: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  src.forEach((value, key) => {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) return;
    out[key] = value;
  });
  return out;
}

/**
 * FIX A — internal proxy hop with ONE transient retry.
 *
 * The freegpt/freeaixyz proxy routes are fetched via `fetch(origin + route)`.
 * When that hop throws (network blip) or answers 5xx (upstream crash), the
 * request is retried once with backoff before the error reaches the client.
 * Only ≥500 statuses are retried — a 5xx from the proxy means NO stream was
 * opened (the proxy returns 200 + SSE for streaming successes), so the
 * client has received nothing yet and the retry is safe.
 */
async function fetchInternalProxyWithRetry(
  url: string,
  init: RequestInit,
  attempts = 2,
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.status >= 500 && attempt < attempts - 1) {
        // Drain the error body so the socket is released before retrying.
        try { await res.text(); } catch { /* ignore */ }
        await sleep(retryDelayMs(attempt));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < attempts - 1 && isTransientUpstreamError(err)) {
        await sleep(retryDelayMs(attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

/** Wrap unknown errors as GatewayError PROVIDER_UNAVAILABLE (PRD §148). */
function wrapUnknown(err: unknown, provider?: string, model?: string): GatewayError {
  if (err instanceof GatewayError) return err;
  if (err instanceof ToolbazError) {
    // Preserve legacy Toolbaz-error shape as a generic upstream error.
    return new GatewayError({
      type: "UPSTREAM_4XX",
      message: err.message,
      provider,
      model,
      requestId: generateRequestId(),
    });
  }
  return new GatewayError({
    type: "PROVIDER_UNAVAILABLE",
    message: err instanceof Error ? err.message : String(err),
    provider,
    model,
    requestId: generateRequestId(),
  });
}

/**
 * Find failover candidates in the catalog (audit D1).
 *
 * Given the originally-requested model, returns up to N OTHER models that
 * share the same upstream id (e.g. user asked for `tb/gpt-5.2` → also try
 * `oc/gpt-5.2`, `l7/gpt-5.2`, etc.). Each candidate's adapter is resolved
 * via the gateway registry; entries without a registered adapter are
 * skipped (no point failing over to a model we can't actually call).
 *
 * The originally-requested model is excluded from the result.
 *
 * Returns at most `limit` candidates (default 1 — audit D1 says cap at 1
 * attempt; don't cascade through all providers).
 */
function findFailoverCandidates(
  originalModel: DiscoveredModel,
  limit = 1,
): Array<{ model: DiscoveredModel; adapter: ProviderAdapter }> {
  const catalog = catalogStore.getCatalog();
  const out: Array<{ model: DiscoveredModel; adapter: ProviderAdapter }> = [];
  for (const m of catalog.models) {
    if (m.id === originalModel.id) continue;
    if (m.upstreamId !== originalModel.upstreamId) continue;
    if (m.providerId === originalModel.providerId) continue;
    if (m.status === "offline") continue;
    const adapter = providerRegistry.get(m.providerId);
    if (!adapter) continue;
    out.push({ model: m, adapter });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Build a ChatRequest for a fallback model (audit D1). Reuses the original
 * request's params but swaps the modelId + upstreamId to the fallback.
 */
function buildFailoverChatReq(
  original: ChatRequest,
  fallbackModel: DiscoveredModel,
): ChatRequest {
  return {
    ...original,
    modelId: fallbackModel.id,
    upstreamId: fallbackModel.upstreamId,
  };
}

/**
 * Lightweight request validation (audit B1, A2). Replaces the prior behavior
 * where wrong-typed params (e.g. `"model": 123`) crashed with HTTP 500
 * empty-body unhandled exceptions.
 *
 * Rules: see audit B1 — model/messages required, sampling params type+range
 * checked, unknown params silently ignored (OpenAI SDK compatibility).
 *
 * Returns null on success, or a GatewayError INVALID_REQUEST to be returned
 * to the client as HTTP 400.
 */
function validateChatRequest(body: unknown): GatewayError | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return new GatewayError({
      type: "INVALID_REQUEST",
      message: "Request body must be a JSON object.",
    });
  }
  const b = body as Record<string, unknown>;

  // model: required, must be a non-empty string.
  if (typeof b.model !== "string" || b.model.length === 0) {
    return new GatewayError({
      type: "INVALID_REQUEST",
      message: "model is required and must be a string",
    });
  }

  // messages: required, must be a non-empty array.
  if (!Array.isArray(b.messages) || b.messages.length === 0) {
    return new GatewayError({
      type: "INVALID_REQUEST",
      message: "messages is required and must be a non-empty array",
    });
  }

  // Each message must have a valid role and content (string | array | null w/ tool_calls).
  const validRoles = new Set(["system", "user", "assistant", "tool", "function"]);
  for (let i = 0; i < b.messages.length; i++) {
    const m = b.messages[i];
    if (!m || typeof m !== "object" || Array.isArray(m)) {
      return new GatewayError({
        type: "INVALID_REQUEST",
        message: `messages[${i}] must be an object`,
      });
    }
    const msg = m as Record<string, unknown>;
    if (typeof msg.role !== "string" || !validRoles.has(msg.role)) {
      return new GatewayError({
        type: "INVALID_REQUEST",
        message: `messages[${i}].role must be one of: system, user, assistant, tool`,
      });
    }
    // content required unless this is an assistant message with tool_calls.
    const hasContent = "content" in msg;
    const hasToolCalls = "tool_calls" in msg;
    if (!hasContent && !(hasToolCalls && msg.role === "assistant")) {
      return new GatewayError({
        type: "INVALID_REQUEST",
        message: `messages[${i}].content is required`,
      });
    }
    if (hasContent) {
      const c = msg.content;
      if (c !== null && typeof c !== "string" && !Array.isArray(c)) {
        return new GatewayError({
          type: "INVALID_REQUEST",
          message: `messages[${i}].content must be a string, null, or an array of content parts`,
        });
      }
    }
  }

  // temperature: number 0-2.
  if (b.temperature !== undefined && b.temperature !== null) {
    const t = b.temperature;
    if (typeof t !== "number" || t < 0 || t > 2) {
      return new GatewayError({
        type: "INVALID_REQUEST",
        message: "temperature must be a number between 0 and 2",
      });
    }
  }

  // max_tokens / max_completion_tokens: positive integer.
  for (const key of ["max_tokens", "max_completion_tokens"] as const) {
    const v = b[key];
    if (v !== undefined && v !== null) {
      if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) {
        return new GatewayError({
          type: "INVALID_REQUEST",
          message: "max_tokens must be a positive integer",
        });
      }
    }
  }

  // top_p: number 0-1.
  if (b.top_p !== undefined && b.top_p !== null) {
    const t = b.top_p;
    if (typeof t !== "number" || t < 0 || t > 1) {
      return new GatewayError({
        type: "INVALID_REQUEST",
        message: "top_p must be a number between 0 and 1",
      });
    }
  }

  // n: positive integer.
  if (b.n !== undefined && b.n !== null) {
    const n = b.n;
    if (typeof n !== "number" || !Number.isInteger(n) || n <= 0) {
      return new GatewayError({
        type: "INVALID_REQUEST",
        message: "n must be a positive integer",
      });
    }
  }

  // stop: string or array of strings.
  if (b.stop !== undefined && b.stop !== null) {
    const s = b.stop;
    if (typeof s === "string") {
      // ok
    } else if (Array.isArray(s)) {
      for (const item of s) {
        if (typeof item !== "string") {
          return new GatewayError({
            type: "INVALID_REQUEST",
            message: "stop must be a string or an array of strings",
          });
        }
      }
    } else {
      return new GatewayError({
        type: "INVALID_REQUEST",
        message: "stop must be a string or an array of strings",
      });
    }
  }

  // seed: integer.
  if (b.seed !== undefined && b.seed !== null) {
    const s = b.seed;
    if (typeof s !== "number" || !Number.isInteger(s)) {
      return new GatewayError({
        type: "INVALID_REQUEST",
        message: "seed must be an integer",
      });
    }
  }

  // stream: boolean.
  if (b.stream !== undefined && b.stream !== null) {
    if (typeof b.stream !== "boolean") {
      return new GatewayError({
        type: "INVALID_REQUEST",
        message: "stream must be a boolean",
      });
    }
  }

  // stream_options: object.
  if (b.stream_options !== undefined && b.stream_options !== null) {
    if (
      typeof b.stream_options !== "object" ||
      Array.isArray(b.stream_options)
    ) {
      return new GatewayError({
        type: "INVALID_REQUEST",
        message: "stream_options must be an object",
      });
    }
  }

  // Unknown params silently ignored (OpenAI SDK compatibility — audit B1).
  return null;
}

/**
 * Normalize an OpenAI message list into the gateway ChatRequest.messages
 * shape (PRD §71). Handles:
 *   - Array content (vision format) — text parts joined, image_url parts
 *     dropped when the model can't do vision, retained as "[image attached]"
 *     note otherwise.
 *   - Tool system prompt injection (buildToolSystemPrompt).
 *   - tool / function role messages (messageToText handles those).
 */
function normalizeMessagesForGateway(
  body: OAIChatCompletionRequest,
  model: DiscoveredModel,
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const out: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];
  const useTools = hasTools(body.tools);
  const wantsWebSearch = body.web_search === true;
  if (wantsWebSearch) {
    out.push({
      role: "system",
      content:
        "The user has requested web-informed answers. If you have live web access via your backend, use it. Otherwise, answer based on your most recent knowledge and clearly note if information may be outdated.",
    });
  }
  if (useTools) {
    if (isNativeToolProvider(model.providerId)) {
      // Native-tools provider: the adapter forwards the REAL API `tools` /
      // `tool_choice` / `parallel_tool_calls` fields (asserted per §20).
      // This short system line only reinforces availability (Tool PRD §8) —
      // it is NEVER a substitute for the API fields themselves.
      out.push({ role: "system", content: TOOL_AVAILABILITY_SYSTEM_PROMPT });
    } else {
      // Emulated provider (no upstream tools API): serialize the tool
      // definitions into the fenced ```tool_call system directive so the
      // model still receives them and can emit structured tool calls.
      out.push({
        role: "system",
        content: buildToolSystemPrompt(body.tools!, body.tool_choice),
      });
    }
  }
  for (const m of body.messages) {
    const role: "system" | "user" | "assistant" =
      m.role === "assistant"
        ? "assistant"
        : m.role === "system"
          ? "system"
          : "user";
    // CONTENT-NORMALIZE (the "image is OPTIONAL, never mandatory" fix — see
    // src/lib/gateway/content-normalize.ts for the LLM7.io root cause).
    // Array-form content with phantom image_url parts is normalized to PLAIN
    // STRING text so non-vision upstreams (LLM7 codestral-latest, gpt-oss:20b,
    // minimax-m2.7, …) never receive the `unsupported_model_feature` 400.
    // Vision models get a `[image attached xN]` text annotation instead of
    // raw image bytes (the gateway does not forward images today).
    const norm = normalizeMessageContent(m.content);
    if (norm.wasArray) {
      if (model.capabilities.vision) {
        if (norm.text || norm.imageCount > 0) {
          out.push({
            role,
            content: norm.text + imageAnnotation(norm.imageCount),
          });
        }
      } else if (norm.text) {
        out.push({ role, content: norm.text });
      }
    } else {
      // Plain string / null content → preserve existing tool/function
      // extraction behaviour (messageToText handles role:tool messages).
      const text = messageToText(m);
      if (text !== null && text !== "") {
        out.push({ role, content: text });
      }
    }
  }
  return out;
}

/** POST /api/v1/chat/completions (CORS-wrapped — see src/lib/api/cors.ts). */
export async function POST(request: Request): Promise<Response> {
  return withCors(await handleChatCompletions(request));
}

/** OPTIONS /api/v1/chat/completions — CORS preflight (204 + allow-headers). */
export async function OPTIONS(): Promise<Response> {
  return corsPreflight();
}

async function handleChatCompletions(request: Request): Promise<Response> {
  // v4 requirement: every error response MUST carry the standard JSON
  // envelope `{ error: { type, message, provider, model, request_id, code,
  // status } }` — including 500s. Before this wrapper, any uncaught
  // exception (TypeError from an unexpected body shape, a bug in
  // resolveAdapterForModel, an OOM, a thrown string instead of an Error)
  // escaped to Next.js's default handler, which returns HTTP 500 with a
  // ZERO-BYTE body. 26 of those blank 500s were observed in the v3 load
  // test (hitting l7/deepseek-v4-flash, tb/codestral-latest, l7/minimax-m2.7
  // and four other tb/* models) — clients parsing JSON got nothing to act
  // on, breaking the R-11 contract. This outermost try/catch guarantees
  // every escape route produces the structured envelope.
  let body: OAIChatCompletionRequest | undefined;
  try {
    await ensureGateway();

    try {
      body = (await request.json()) as OAIChatCompletionRequest;
    } catch {
      return gatewayErrorResponse(
        new GatewayError({
          type: "INVALID_REQUEST",
          message: "Invalid JSON body.",
        }),
      );
    }

    // ─── Audit B1/A2: validate input BEFORE model lookup ────────────────────
    // Wrong-typed params (e.g. `"model": 123`) now return 400 with a clear
    // message instead of crashing with HTTP 500 empty body (unhandled exception).
    const validationError = validateChatRequest(body);
    if (validationError) {
      return gatewayErrorResponse(validationError);
    }

    // ─── Tool PRD §6: validate + normalize tools BEFORE any routing ─────────
    // Malformed tool schemas are rejected with TOOL_SCHEMA_INVALID — never
    // forwarded upstream, never silently dropped (§5, §6).
    let toolParams: ValidatedToolParams;
    try {
      toolParams = validateToolParams(body);
    } catch (err) {
      if (err instanceof GatewayError) return gatewayErrorResponse(err);
      throw err;
    }

    const wantsStream = body.stream === true;
    const useTools = toolParams.tools.length > 0;

    // ─── NEW GATEWAY PATH (canonical ids like fg/gpt-5, oc/big-pickle) ────────
    const resolved = resolveAdapterForModel(body.model);
    if (resolved) {
      return handleCanonicalRequest(body, request, resolved.model, resolved.adapter, toolParams, wantsStream);
    }

    // ─── LEGACY FALLBACK (old-style ids like fgpt-gpt-5-5, oc-big-pickle) ─────
    return handleLegacyRequest(body, request, toolParams, wantsStream);
  } catch (err) {
    // v4: any uncaught exception → standard JSON envelope (never a blank 500).
    // wrapUnknown converts TypeError/Error/string into a GatewayError with
    // type PROVIDER_UNAVAILABLE (retryable 503) so clients can retry. The
    // model id is surfaced if `body` was already parsed.
    const modelId =
      body && typeof body.model === "string" ? body.model : undefined;
    return gatewayErrorResponse(wrapUnknown(err, undefined, modelId));
  }
}

// ───────────────────────────────────────────────────────────────────────────
// NEW GATEWAY PATH
// ───────────────────────────────────────────────────────────────────────────

/** Handle a request whose model resolved to a catalog entry (canonical id). */
async function handleCanonicalRequest(
  body: OAIChatCompletionRequest,
  request: Request,
  model: DiscoveredModel,
  adapter: ProviderAdapter,
  toolParams: ValidatedToolParams,
  wantsStream: boolean,
): Promise<Response> {
  const useTools = toolParams.tools.length > 0;
  // Circuit-breaker check (PRD §121, §122, R-8).
  //
  // R-8: the breaker is keyed per-ROUTE (model id), NOT just per-provider.
  // The audit found that a single failing model of a provider took down
  // its healthy siblings (`tb/gpt-5`, both `ss/*` models all scored
  // 0% under load but 100% when serialized — BUG-6). The per-provider
  // breaker is still consulted for genuine provider-wide outages, but
  // the per-model breaker now fires independently so one bad sibling
  // cannot trip its healthy neighbours.
  if (providerHealthService.isModelOpen(model.id)) {
    const err = new GatewayError({
      type: "PROVIDER_UNAVAILABLE",
      message: `Model "${model.id}" is temporarily unavailable (circuit open). Retry later.`,
      provider: model.providerId,
      model: model.id,
    });
    return gatewayErrorResponse(err);
  }
  if (providerHealthService.isOpen(model.providerId)) {
    const err = new GatewayError({
      type: "PROVIDER_UNAVAILABLE",
      message: `Provider "${model.providerId}" is temporarily unavailable (circuit open). Retry later.`,
      provider: model.providerId,
      model: model.id,
    });
    return gatewayErrorResponse(err);
  }

  // ─── Tool PRD §21: capability mismatch gate ───────────────────────────────
  // A model that does not support tools must never receive them — and must
  // never be told it has them. Surface TOOL_UNSUPPORTED to the CALLER
  // instead of silently downgrading the request.
  if (useTools && model.capabilities.tools === false) {
    return gatewayErrorResponse(
      new GatewayError({
        type: "TOOL_UNSUPPORTED",
        message: `Model "${model.id}" does not support tool calling. Remove the "tools" field for this model.`,
        provider: model.providerId,
        model: model.id,
      }),
    );
  }

  // ─── Tool PRD §19/§27: request-side diagnostics (names/counts only) ───────
  toolDiagnostics.record({
    id: `req-${model.id}-${Date.now()}`,
    kind: "request",
    at: new Date().toISOString(),
    model: model.id,
    provider: model.providerId,
    streaming: wantsStream,
    capabilitiesTools: model.capabilities.tools,
    nativeForwarding: useTools && isNativeToolProvider(model.providerId),
    toolsRequested: toolParams.tools.length,
    toolNames: toolDiagnostics.toolNames(toolParams.tools),
    toolChoice: toolDiagnostics.describeToolChoice(toolParams.toolChoice),
  });

  // Build normalized messages for the gateway contract. Computed BEFORE the
  // FreeAIXYZ proxy branch so the proxy receives the tool system prompt too
  // (root-cause fix: raw body.messages previously bypassed the emulation
  // prompt for fx/* models → "I don't have access to tools").
  const messages = normalizeMessagesForGateway(body, model);
  if (messages.length === 0) {
    return gatewayErrorResponse(
      new GatewayError({
        type: "INVALID_REQUEST",
        message: "No usable messages after serialization.",
        model: model.id,
        provider: model.providerId,
      }),
    );
  }

  // ─── FreeAIXYZ special-proxy routing ─────────────────────────────────────
  // The FreeAIXYZ upstream (unlimitedai.org) is behind Cloudflare TLS
  // fingerprinting — plain Node fetch returns 403 (verified). The
  // freeaixyz-proxy route uses curl via child_process which bypasses the
  // fingerprint check. Route canonical `fx/<upstreamId>` ids through the
  // proxy too — the legacy adapter's fetch-based stream() cannot reach the
  // upstream successfully. (Same reasoning as the legacy `fxyz-*` ids
  // below.)
  //
  // R-1: validate non-empty content BEFORE routing to the proxy. The fx/*
  // upstream leaks its internal cache-writer error string ("Data to cache
  // (message or image) cannot be empty.") back to the client as an opaque
  // 502 (or 200 + in-band SSE error frame when streaming). All 16 other
  // adapters do this validation locally; the fx/* path was missing it.
  // Variants A/E/F/G/I from the audit report all reproduce the leak —
  // reject them here with HTTP 400 invalid_request_error instead.
  if (model.providerId === "freeaixyz") {
    if (!hasNonEmptyContent(body.messages)) {
      return gatewayErrorResponse(emptyContentError(model.id, model.providerId));
    }
    const origin = new URL(request.url).origin;
    const proxyRoute = "/api/v1/chat/freeaixyz-proxy";
    const proxyBody = {
      // Pass the canonical id — the proxy parses it back into the upstream id.
      model: body.model,
      // Normalized gateway messages — includes the tool system prompt for
      // this emulated (non-native-tools) upstream so the model actually
      // receives the tool definitions (Tool PRD §5 — tools must survive
      // EVERY transformation layer, including the internal proxy hop).
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: wantsStream,
      tools: useTools ? toolParams.tools : undefined,
      toolChoice: useTools ? (toolParams.toolChoice ?? "auto") : undefined,
      parallelToolCalls: useTools ? toolParams.parallelToolCalls : undefined,
      // Forward sampling params (audit E1).
      temperature: body.temperature,
      maxTokens: body.max_tokens ?? body.max_completion_tokens ?? undefined,
      topP: body.top_p,
      stop: body.stop ?? undefined,
      seed: body.seed ?? undefined,
      presencePenalty: body.presence_penalty,
      frequencyPenalty: body.frequency_penalty,
      n: body.n ?? undefined,
      streamOptions: body.stream_options ?? undefined,
    };
    try {
      const proxyRes = await fetchInternalProxyWithRetry(`${origin}${proxyRoute}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: wantsStream ? "text/event-stream" : "application/json",
        },
        body: JSON.stringify(proxyBody),
        signal: request.signal,
      });
      // R-4: strip hop-by-hop + content-encoding headers from the internal
      // proxy response before passing through. The internal fetch asks for
      // brotli/gzip via Accept-Encoding, and the proxy route builds its own
      // uncompressed body — inheriting `content-encoding: br` here would
      // break spec-compliant HTTP clients (BUG-2).
      return new Response(proxyRes.body, {
        status: proxyRes.status,
        headers: cleanProxyHeaders(proxyRes.headers),
      });
    } catch (err) {
      return gatewayErrorResponse(wrapUnknown(err, model.providerId, model.id));
    }
  }

  const chatReq: ChatRequest = {
    modelId: model.id,
    upstreamId: model.upstreamId,
    messages,
    stream: wantsStream,
    signal: request.signal,
    temperature: body.temperature,
    maxTokens: body.max_tokens ?? body.max_completion_tokens ?? undefined,
    topP: body.top_p,
    stop: body.stop ?? undefined,
    seed: body.seed ?? undefined,
    presencePenalty: body.presence_penalty,
    frequencyPenalty: body.frequency_penalty,
    n: body.n ?? undefined,
    streamOptions: body.stream_options ?? undefined,
    // Tool PRD §5/§9 — tools, tool_choice (string OR object form), and
    // parallel_tool_calls are preserved through every transformation layer.
    tools: useTools ? toolParams.tools : undefined,
    toolChoice: useTools ? toolParams.toolChoice : undefined,
    parallelToolCalls: toolParams.parallelToolCalls,
  };

  if (wantsStream) {
    // Streaming path — streamChat returns a ready Response (the streaming fix).
    // Forwards every upstream delta immediately, no buffering/re-pacing.
    // Audit D1: build failover candidates from the catalog — when the primary
    // adapter fails BEFORE any content is forwarded, the streaming-proxy will
    // try each fallback in order. Cap at 1 attempt.
    const fallbacks: FailoverCandidate[] = findFailoverCandidates(model, 1).map(
      ({ model: fm, adapter: fa }) => ({
        req: buildFailoverChatReq(chatReq, fm),
        adapter: fa,
      }),
    );
    try {
      const { response, timings } = await streamChat(chatReq, adapter, fallbacks);
      metricsService.recordStreamTimings(timings);
      return response;
    } catch (err) {
      const ge = wrapUnknown(err, adapter.id, model.id);
      providerHealthService.recordProviderFailure(adapter.id, err);
      providerHealthService.recordModelFailure(model.id, err);
      return gatewayErrorResponse(ge);
    }
  }

  // Non-streaming path — adapter.complete + OpenAI-shaped JSON.
  // Audit D1: try the primary; if it fails with a failover-candidate error
  // type (5xx, rate-limit, provider-unavailable), retry ONCE with a
  // fallback model from the catalog (same upstream id, different provider).
  const requestStart = Date.now();
  const requestId = generateRequestId();
  const promptText = messages.map((m) => m.content).join("\n");
  const fallbacks = findFailoverCandidates(model, 1);
  let usedFallback: { model: DiscoveredModel; adapter: ProviderAdapter } | null = null;
  let text: string | null = null;
  let primaryErr: GatewayError | null = null;
  // FIX A: transient upstream failures (network / 5xx / 429 / upstream edge
  // crashes like the intermittent "edge runtime does not support Node.js
  // 'crypto' module" 502) get ONE same-model retry with linear backoff BEFORE
  // the audit-D1 provider failover runs — the live diagnosis showed those
  // failures succeed on the immediate next attempt.
  let completeErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await adapter.complete(chatReq);
      text = result.text;
      completeErr = null;
      break;
    } catch (err) {
      completeErr = err;
      if (attempt === 0 && isTransientUpstreamError(err)) {
        await sleep(retryDelayMs(attempt));
        continue;
      }
      break;
    }
  }
  if (completeErr !== null) {
    const err = completeErr;
    primaryErr = wrapUnknown(err, adapter.id, model.id);
    providerHealthService.recordProviderFailure(adapter.id, err);
    providerHealthService.recordModelFailure(model.id, err);
    // Audit D1: only failover if the error is a retryable candidate.
    if (isFailoverCandidate(primaryErr) && fallbacks.length > 0) {
      const fb = fallbacks[0];
      const fbReq = buildFailoverChatReq(chatReq, fb.model);
      try {
        const result = await fb.adapter.complete(fbReq);
        text = result.text;
        usedFallback = fb;
      } catch (err2) {
        // Both attempts failed — return a 502 documenting both.
        const fbErr = wrapUnknown(err2, fb.adapter.id, fb.model.id);
        providerHealthService.recordProviderFailure(fb.adapter.id, err2);
        providerHealthService.recordModelFailure(fb.model.id, err2);
        const combined = new GatewayError({
          type: "UPSTREAM_5XX",
          status: 502,
          message: `Both primary (${model.id} via ${adapter.id}) and fallback (${fb.model.id} via ${fb.adapter.id}) failed. Primary: ${primaryErr.message}. Fallback: ${fbErr.message}.`,
          provider: adapter.id,
          model: model.id,
          requestId,
        });
        metricsService.recordRequest({
          requestId,
          providerId: adapter.id,
          modelId: model.id,
          status: 502,
          type: "complete_error",
          message: combined.message,
          streamRequested: false,
          durationMs: Date.now() - requestStart,
        });
        const res = NextResponse.json(
          { error: combined.toJSON() },
          { status: 502, headers: { "Content-Type": "application/json" } },
        );
        res.headers.set("X-Failover", `${model.id}→${fb.model.id} (failed)`);
        return res;
      }
    } else {
      // No failover possible — surface the primary error.
      metricsService.recordRequest({
        requestId,
        providerId: adapter.id,
        modelId: model.id,
        status: primaryErr.status,
        type: "complete_error",
        message: primaryErr.message,
        streamRequested: false,
        durationMs: Date.now() - requestStart,
      });
      return gatewayErrorResponse(primaryErr);
    }
  }

  // Success path — record metrics + build OpenAI-shaped response.
  const finalAdapter = usedFallback ? usedFallback.adapter : adapter;
  const finalModel = usedFallback ? usedFallback.model : model;
  providerHealthService.recordProviderSuccess(finalAdapter.id);
  providerHealthService.recordModelSuccess(finalModel.id);
  metricsService.recordRequest({
    requestId,
    providerId: finalAdapter.id,
    modelId: finalModel.id,
    status: 200,
    type: "complete",
    message: "ok",
    streamRequested: false,
    durationMs: Date.now() - requestStart,
  });

  // R-5: refuse to pass on a silent empty success. The audit found 137
  // requests (9.2%) that returned HTTP 200 with `content:""` and
  // `finish_reason:"stop"` — clients cannot distinguish these from a
  // legitimate empty answer, which corrupts downstream logic. Surface
  // them as 502 `empty_upstream_response` instead. Tool-call parsing
  // below extracts non-empty tool envelopes even from sparse text, so
  // the empty-check only fires when there is genuinely no content AND
  // no tool calls.
  const trimmedText = (text ?? "").trim();
  if (trimmedText === "") {
    providerHealthService.recordProviderFailure(finalAdapter.id, new Error("empty_upstream_response"));
    providerHealthService.recordModelFailure(finalModel.id, new Error("empty_upstream_response"));
    metricsService.recordRequest({
      requestId,
      providerId: finalAdapter.id,
      modelId: finalModel.id,
      status: 502,
      type: "complete_error",
      message: "empty_upstream_response",
      streamRequested: false,
      durationMs: Date.now() - requestStart,
    });
    return gatewayErrorResponse(
      emptyUpstreamResponseError(finalAdapter.id, finalModel.id),
    );
  }

  // Tool-call envelope parsing (emulated fence + __tool_calls markers).
  if (useTools && text !== null) {
    const parsed = parseToolCalls(text, generateToolCallId);
    if (parsed.toolCalls.length > 0) {
      toolDiagnostics.record({
        id: `fin-${finalModel.id}-${requestId}`,
        kind: "final",
        at: new Date().toISOString(),
        model: finalModel.id,
        provider: finalAdapter.id,
        toolCallsDetected: parsed.toolCalls.length,
        finalStatus: "success",
      });
      const payload: OAIChatCompletionResponse = {
        id: generateCompletionId(),
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: finalModel.id,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: parsed.text || null,
              tool_calls: parsed.toolCalls,
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: {
          prompt_tokens: estimateTokens(promptText),
          completion_tokens: estimateTokens(text),
          total_tokens: estimateTokens(promptText) + estimateTokens(text),
        },
      };
      const res = NextResponse.json(payload);
      if (usedFallback) {
        res.headers.set("X-Failover", `${model.id}→${finalModel.id}`);
      }
      return res;
    }
  }

  const finalText: string = text ?? "";
  const payload: OAIChatCompletionResponse = {
    id: generateCompletionId(),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: finalModel.id,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: finalText },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: estimateTokens(promptText),
      completion_tokens: estimateTokens(finalText),
      total_tokens: estimateTokens(promptText) + estimateTokens(finalText),
    },
  };
  const res = NextResponse.json(payload);
  if (usedFallback) {
    res.headers.set("X-Failover", `${model.id}→${finalModel.id}`);
  }
  return res;
}

// ───────────────────────────────────────────────────────────────────────────
// LEGACY FALLBACK PATH (old-style ids — fake-stream re-pacer REMOVED)
// ───────────────────────────────────────────────────────────────────────────

/** Build the ProviderMessage list for a legacy model. */
function buildLegacyMessages(
  body: OAIChatCompletionRequest,
  model: GatewayModel,
): ProviderMessage[] {
  const messages: ProviderMessage[] = [];
  const useTools = hasTools(body.tools);
  const wantsWebSearch = body.web_search === true;

  if (wantsWebSearch && !model.capabilities.webSearch) {
    messages.push({
      role: "system",
      content:
        "The user has requested web-informed answers. If you have live web access via your backend, use it. Otherwise, answer based on your most recent knowledge and clearly note if information may be outdated.",
    });
  }
  if (useTools) {
    if (isNativeToolProvider(model.provider)) {
      // Native-tools provider — the adapter forwards the REAL API fields
      // (asserted per §20); this line only reinforces availability (§8).
      messages.push({
        role: "system",
        content: TOOL_AVAILABILITY_SYSTEM_PROMPT,
      });
    } else {
      // Emulated provider — fenced ```tool_call directive.
      messages.push({
        role: "system",
        content: buildToolSystemPrompt(body.tools!, body.tool_choice),
      });
    }
  }
  for (const m of body.messages) {
    const role = m.role as ProviderMessage["role"];
    // CONTENT-NORMALIZE — same contract as the canonical path
    // (see src/lib/gateway/content-normalize.ts). Array-form content with
    // phantom image_url parts is normalized to PLAIN STRING text so legacy
    // non-vision upstreams (LLM7 codestral-latest, etc.) never receive the
    // `unsupported_model_feature` 400. Image input is OPTIONAL, never
    // mandatory. The legacy path does NOT annotate (legacy vision models
    // get text-only — same as before).
    const norm = normalizeMessageContent(m.content);
    if (norm.wasArray) {
      if (norm.text) {
        messages.push({ role, content: norm.text });
      }
    } else {
      const text = messageToText(m);
      if (text !== null && text !== "") {
        messages.push({ role, content: text });
      }
    }
  }
  return messages;
}

/**
 * Extract the OpenAI sampling params from the request body (audit E1).
 * These are forwarded to OpenAI-compatible legacy providers (opencode,
 * llm7, kilocode, vexa, gptoss, swarm). Custom-POST providers
 * (surfsense, jollygen, unlimitedai, freechat, miklium, spicywriter,
 * freeaixyz, toolbaz) silently ignore them.
 */
function extractSampling(body: OAIChatCompletionRequest) {
  return {
    temperature: body.temperature,
    maxTokens: body.max_tokens ?? body.max_completion_tokens ?? undefined,
    topP: body.top_p,
    stop: body.stop ?? undefined,
    seed: body.seed ?? undefined,
    presencePenalty: body.presence_penalty,
    frequencyPenalty: body.frequency_penalty,
    n: body.n ?? undefined,
    streamOptions: body.stream_options ?? undefined,
  };
}

/** Handle a legacy-style id (resolveGatewayModel fallback). */
async function handleLegacyRequest(
  body: OAIChatCompletionRequest,
  request: Request,
  toolParams: ValidatedToolParams,
  wantsStream: boolean,
): Promise<Response> {
  const useTools = toolParams.tools.length > 0;
  const model = resolveGatewayModel(body.model);
  if (!model) {
    // Unknown model — surface a clean MODEL_NOT_FOUND rather than routing
    // the request to an unrelated provider (the legacy behaviour forwarded
    // unknown ids to OpenCode as a passthrough, which surfaced as confusing
    // 401 "Model <id> is not supported" errors from the OpenCode upstream).
    return gatewayErrorResponse(
      new GatewayError({
        type: "MODEL_NOT_FOUND",
        message: `Model "${body.model}" was not found in the catalog. Check GET /api/v1/models for the list of available canonical ids (e.g. "tb/gpt-5", "au/llama3-8b", "l7/minimax-m2.7").`,
        status: 404,
      }),
    );
  }

  // R-8: per-route circuit breaker for legacy ids too. The legacy model.id
  // is the old-style slug; we use the canonical id (via `canonicalOrLegacyId`)
  // when available so the breaker state matches between the two paths.
  const breakerKey = canonicalOrLegacyId(model);
  if (providerHealthService.isModelOpen(breakerKey)) {
    return gatewayErrorResponse(
      new GatewayError({
        type: "PROVIDER_UNAVAILABLE",
        message: `Model "${model.id}" is temporarily unavailable (circuit open). Retry later.`,
        provider: model.provider,
        model: model.id,
      }),
    );
  }
  if (providerHealthService.isOpen(model.provider)) {
    return gatewayErrorResponse(
      new GatewayError({
        type: "PROVIDER_UNAVAILABLE",
        message: `Provider "${model.provider}" is temporarily unavailable (circuit open). Retry later.`,
        provider: model.provider,
        model: model.id,
      }),
    );
  }

  // ─── Tool PRD §21: capability mismatch gate (legacy ids too) ──────────
  if (useTools && model.capabilities.tools === false) {
    return gatewayErrorResponse(
      new GatewayError({
        type: "TOOL_UNSUPPORTED",
        message: `Model "${model.id}" does not support tool calling. Remove the "tools" field for this model.`,
        provider: model.provider,
        model: model.id,
      }),
    );
  }

  // ─── Tool PRD §19/§27: request-side diagnostics (names/counts only) ───
  toolDiagnostics.record({
    id: `req-${model.id}-${Date.now()}`,
    kind: "request",
    at: new Date().toISOString(),
    model: model.id,
    provider: model.provider,
    streaming: wantsStream,
    capabilitiesTools: model.capabilities.tools,
    nativeForwarding: useTools && isNativeToolProvider(model.provider),
    toolsRequested: toolParams.tools.length,
    toolNames: toolDiagnostics.toolNames(toolParams.tools),
    toolChoice: toolDiagnostics.describeToolChoice(toolParams.toolChoice),
  });

  const messages = buildLegacyMessages(body, model);
  if (messages.length === 0) {
    return gatewayErrorResponse(
      new GatewayError({
        type: "INVALID_REQUEST",
        message: "No usable messages after serialization.",
        model: model.id,
        provider: model.provider,
      }),
    );
  }

  // FreeGPT / FreeAIXYZ special-proxy branch — kept for legacy ids (PRD §238).
  // The proxy route now surfaces GatewayError 403 from the freegpt adapter
  // (Phase 2b fix) directly to the client.
  //
  // R-1: validate non-empty content BEFORE routing to either proxy. Same
  // reasoning as the canonical fx/* branch above — without this, the
  // upstream leaks an internal cache-writer / challenge error string.
  // R-4: strip hop-by-hop + content-encoding headers when passing through
  // the internal proxy response (BUG-2 brotli-header leak).
  if (model.provider === "freegpt" || model.provider === "freeaixyz") {
    if (!hasNonEmptyContent(body.messages)) {
      return gatewayErrorResponse(emptyContentError(model.id, model.provider));
    }
    const origin = new URL(request.url).origin;
    const proxyRoute =
      model.provider === "freegpt"
        ? "/api/v1/chat/freegpt-proxy"
        : "/api/v1/chat/freeaixyz-proxy";
    const sampling = extractSampling(body);
    const proxyBody = {
      model: body.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: wantsStream,
      tools: useTools ? toolParams.tools : undefined,
      toolChoice: useTools ? (toolParams.toolChoice ?? "auto") : undefined,
      parallelToolCalls: useTools ? toolParams.parallelToolCalls : undefined,
      // Forward sampling params so the proxy can pass them upstream (audit E1).
      temperature: sampling.temperature,
      maxTokens: sampling.maxTokens,
      topP: sampling.topP,
      stop: sampling.stop,
      seed: sampling.seed,
      presencePenalty: sampling.presencePenalty,
      frequencyPenalty: sampling.frequencyPenalty,
      n: sampling.n,
      streamOptions: sampling.streamOptions,
    };
    try {
      const proxyRes = await fetchInternalProxyWithRetry(`${origin}${proxyRoute}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: wantsStream ? "text/event-stream" : "application/json",
        },
        body: JSON.stringify(proxyBody),
        signal: request.signal,
      });
      // R-4: pass through the response with cleaned headers (BUG-2).
      return new Response(proxyRes.body, {
        status: proxyRes.status,
        headers: cleanProxyHeaders(proxyRes.headers),
      });
    } catch (err) {
      return gatewayErrorResponse(wrapUnknown(err, model.provider, model.id));
    }
  }

  let provider: ReturnType<typeof getProvider>;
  try {
    provider = getProvider(model.provider);
  } catch (err) {
    return gatewayErrorResponse(wrapUnknown(err, model.provider, model.id));
  }
  // Tool PRD §5/§9 — preserve the validated tools, tool_choice (string OR
  // object form) and parallel_tool_calls for the legacy adapter call.
  const nativeTools = useTools ? toolParams.tools : undefined;
  const nativeToolChoice = useTools ? (toolParams.toolChoice ?? "auto") : undefined;
  const nativeParallelToolCalls = useTools ? toolParams.parallelToolCalls : undefined;
  const sampling = extractSampling(body);

  if (wantsStream) {
    return legacyStreamCompletion(
      model,
      provider,
      messages,
      useTools,
      request,
      nativeTools,
      nativeToolChoice,
      nativeParallelToolCalls,
      sampling,
    );
  }
  return legacyJsonCompletion(
    model,
    provider,
    messages,
    useTools,
    nativeTools,
    nativeToolChoice,
    nativeParallelToolCalls,
    sampling,
  );
}

/** Non-streaming legacy completion — uses adapter.complete, wraps errors. */
async function legacyJsonCompletion(
  model: GatewayModel,
  provider: ReturnType<typeof getProvider>,
  messages: ProviderMessage[],
  useTools: boolean,
  tools: unknown[] | undefined,
  toolChoice: OAIToolChoice | undefined,
  parallelToolCalls: boolean | undefined,
  sampling: ReturnType<typeof extractSampling>,
): Promise<Response> {
  const requestStart = Date.now();
  const requestId = generateRequestId();
  let text: string;
  try {
    // FIX A: one transient retry before the error surfaces to the client.
    const result = await withRetry(() =>
      provider.complete({
        model,
        messages,
        tools: tools as ProviderTool[] | undefined,
        toolChoice,
        parallelToolCalls,
        ...sampling,
      }),
    );
    text = result.text;
  } catch (err) {
    const ge = wrapUnknown(err, model.provider, model.id);
    metricsService.recordRequest({
      requestId,
      providerId: model.provider,
      modelId: model.id,
      status: ge.status,
      type: "complete_error",
      message: ge.message,
      streamRequested: false,
      durationMs: Date.now() - requestStart,
    });
    return gatewayErrorResponse(ge);
  }

  metricsService.recordRequest({
    requestId,
    providerId: model.provider,
    modelId: model.id,
    status: 200,
    type: "complete",
    message: "ok",
    streamRequested: false,
    durationMs: Date.now() - requestStart,
  });

  // R-5: refuse to pass on a silent empty success (legacy non-stream path).
  // Same logic as the canonical path above — empty text means the upstream
  // replied with content:"" and finish_reason:"stop", which clients can't
  // distinguish from a legitimate empty answer. Surface as 502 instead.
  const trimmedText = (text ?? "").trim();
  if (trimmedText === "") {
    providerHealthService.recordProviderFailure(model.provider, new Error("empty_upstream_response"));
    providerHealthService.recordModelFailure(model.id, new Error("empty_upstream_response"));
    metricsService.recordRequest({
      requestId,
      providerId: model.provider,
      modelId: model.id,
      status: 502,
      type: "complete_error",
      message: "empty_upstream_response",
      streamRequested: false,
      durationMs: Date.now() - requestStart,
    });
    return gatewayErrorResponse(
      emptyUpstreamResponseError(model.provider, model.id),
    );
  }

  const promptText = messages.map((m) => m.content).join("\n");
  if (useTools) {
    const parsed = parseToolCalls(text, generateToolCallId);
    if (parsed.toolCalls.length > 0) {
      toolDiagnostics.record({
        id: `fin-${model.id}-${requestId}`,
        kind: "final",
        at: new Date().toISOString(),
        model: model.id,
        provider: model.provider,
        toolCallsDetected: parsed.toolCalls.length,
        finalStatus: "success",
      });
      const payload: OAIChatCompletionResponse = {
        id: generateCompletionId(),
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: model.id,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: parsed.text || null,
              tool_calls: parsed.toolCalls,
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: {
          prompt_tokens: estimateTokens(promptText),
          completion_tokens: estimateTokens(text),
          total_tokens: estimateTokens(promptText) + estimateTokens(text),
        },
      };
      return NextResponse.json(payload);
    }
  }
  const payload: OAIChatCompletionResponse = {
    id: generateCompletionId(),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: model.id,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: estimateTokens(promptText),
      completion_tokens: estimateTokens(text),
      total_tokens: estimateTokens(promptText) + estimateTokens(text),
    },
  };
  return NextResponse.json(payload);
}

/**
 * Real-stream providers — their stream() yields genuine upstream deltas
 * that we forward immediately. Providers NOT in this set return the full
 * text in a single delta; we emit ONE content chunk + stop (PRD §137 —
 * honest, no re-pacing).
 */
function isRealStreamProvider(provider: string): boolean {
  return [
    "auroraai",
    "surfsense",
    "jollygen",
    "unlimitedai",
    "kilocode",
    "llm7",
    "spicywriter",
    "opencode",
    "freechat",
    "swarm",
    "gptoss",
    "vexa",
  ].includes(provider);
}

/**
 * Legacy streaming completion. Fake streamText() re-pacer REMOVED (PRD §137).
 *
 * - Real-stream providers: each upstream delta is forwarded immediately as
 *   its own SSE chunk. NO buffering, NO sleep, NO heartbeat.
 * - Non-stream providers: full text arrives at once via provider.stream();
 *   we emit ONE content chunk + stop (honest, not fake-streamed).
 * - Tool path: buffer full output silently (must parse tool envelope),
 *   emit tool_calls or one-content-chunk + stop.
 */
async function legacyStreamCompletion(
  model: GatewayModel,
  provider: ReturnType<typeof getProvider>,
  messages: ProviderMessage[],
  useTools: boolean,
  request: Request,
  tools: unknown[] | undefined,
  toolChoice: OAIToolChoice | undefined,
  parallelToolCalls: boolean | undefined,
  sampling: ReturnType<typeof extractSampling>,
): Promise<Response> {
  const id = generateCompletionId();
  const created = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();
  const signal = request.signal;
  const requestId = generateRequestId();
  const requestStart = Date.now();

  // ─── PRE-FLIGHT (R-2 TRUE FIX) ─────────────────────────────────────────
  // Probe the upstream by awaiting the FIRST chunk (or first throw) BEFORE
  // opening the 200 OK SSE stream. Pre-first-token errors now return a real
  // HTTP error Response (404/502/429/401/…) with a JSON body — NOT a 200 OK
  // SSE stream with an in-band `event: error` frame that the client can't
  // classify (producing the dreaded `Status: N/A` rendering). Mid-stream
  // errors (after at least one chunk is forwarded) keep the existing
  // `event: error` + terminal-chunk behavior.
  let gen: AsyncGenerator<string, void, unknown>;
  try {
    gen = provider.stream({
      model,
      messages,
      signal,
      tools: tools as ProviderTool[] | undefined,
      toolChoice,
      parallelToolCalls,
      ...sampling,
    });
  } catch (err) {
    const ge = wrapUnknown(err, model.provider, model.id);
    providerHealthService.recordProviderFailure(model.provider, err);
    providerHealthService.recordModelFailure(canonicalOrLegacyId(model), err);
    metricsService.recordRequest({
      requestId,
      providerId: model.provider,
      modelId: model.id,
      status: ge.status,
      type: "stream_error",
      message: ge.message,
      streamRequested: true,
      durationMs: Date.now() - requestStart,
    });
    return gatewayErrorResponse(ge);
  }

  let firstDelta = "";
  try {
    const first = await gen.next();
    if (first.done) {
      // Generator returned without yielding anything → empty upstream.
      const emptyErr = emptyUpstreamResponseError(model.provider, model.id);
      providerHealthService.recordProviderFailure(model.provider, emptyErr);
      providerHealthService.recordModelFailure(canonicalOrLegacyId(model), emptyErr);
      metricsService.recordRequest({
        requestId,
        providerId: model.provider,
        modelId: model.id,
        status: 502,
        type: "stream_error",
        message: "empty_upstream_response",
        streamRequested: true,
        durationMs: Date.now() - requestStart,
      });
      try { await gen.return(undefined); } catch { /* best-effort */ }
      return gatewayErrorResponse(emptyErr);
    }
    firstDelta = first.value ?? "";
  } catch (err) {
    const ge = wrapUnknown(err, model.provider, model.id);
    providerHealthService.recordProviderFailure(model.provider, err);
    providerHealthService.recordModelFailure(canonicalOrLegacyId(model), err);
    metricsService.recordRequest({
      requestId,
      providerId: model.provider,
      modelId: model.id,
      status: ge.status,
      type: "stream_error",
      message: ge.message,
      streamRequested: true,
      durationMs: Date.now() - requestStart,
    });
    try { await gen.return(undefined); } catch { /* best-effort */ }
    return gatewayErrorResponse(ge);
  }

  // ─── PRE-FLIGHT SUCCEEDED → open 200 OK SSE stream ──────────────────────
  // TransformStream gives us backpressure + flushes chunks individually
  // (PRD §11, §12). No setInterval heartbeat — it can buffer.
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();

  const send = async (obj: unknown): Promise<void> => {
    try {
      await writer.ready;
      await writer.write(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
    } catch {
      // writer closed — stream is done.
    }
  };

  const enqueue = async (bytes: string): Promise<void> => {
    try {
      await writer.ready;
      await writer.write(encoder.encode(bytes));
    } catch {
      // best-effort
    }
  };

  // Helper to emit a mid-stream error (event:error + terminal chunk). Used
  // when the upstream throws AFTER at least one content chunk has been
  // forwarded (the pre-flight only catches pre-first-token throws).
  const sendStreamError = async (err: GatewayError): Promise<void> => {
    try {
      await enqueue(sseErrorEvent(err));
      await enqueue(sseTerminalErrorChunk(err, id, created, model.id));
    } catch {
      // best-effort
    }
  };

  // Don't await — start writing in the background so the Response can be
  // returned immediately with the readable stream.
  (async () => {
    let hadError = false;
    try {
      // initial role chunk
      await send({
        id,
        object: "chat.completion.chunk",
        created,
        model: model.id,
        choices: [
          { index: 0, delta: { role: "assistant" }, finish_reason: null },
        ],
      });

      if (useTools) {
        // ---- Tool path: buffer full output, parse envelope, emit. ----
        // firstDelta is already in hand from the pre-flight; accumulate the
        // rest from the (already-opened) generator.
        let fullText = firstDelta;
        for await (const delta of gen) {
          if (signal.aborted) break;
          if (delta) fullText += delta;
        }
        if (signal.aborted) {
          await writer.close();
          return;
        }
        const parsed = parseToolCalls(fullText, generateToolCallId);
        if (parsed.toolCalls.length > 0) {
          for (let i = 0; i < parsed.toolCalls.length; i++) {
            const tc: OAIToolCall = parsed.toolCalls[i];
            await send({
              id,
              object: "chat.completion.chunk",
              created,
              model: model.id,
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: i,
                        id: tc.id,
                        type: "function",
                        function: {
                          name: tc.function.name,
                          arguments: tc.function.arguments,
                        },
                      },
                    ],
                  },
                  finish_reason: null,
                },
              ],
            });
          }
          await send({
            id,
            object: "chat.completion.chunk",
            created,
            model: model.id,
            choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
          });
        } else {
          // No tool calls — emit ONE content chunk with the full text + stop.
          // (PRD §137 — never fake-stream non-streaming provider output.)
          const content = (parsed.text || fullText || "").trim();
          if (!content) {
            // R-5: empty upstream reply → mid-stream error event + terminal
            // chunk (the stream is already open over 200 OK, so we can't
            // promote this to a real HTTP status — but clients parsing SSE
            // will see the structured error and the top-level http_status
            // field on the SSE error frame).
            hadError = true;
            const emptyErr = emptyUpstreamResponseError(model.provider, model.id);
            await sendStreamError(emptyErr);
            providerHealthService.recordProviderFailure(model.provider, emptyErr);
            providerHealthService.recordModelFailure(canonicalOrLegacyId(model), emptyErr);
            metricsService.recordRequest({
              requestId,
              providerId: model.provider,
              modelId: model.id,
              status: 502,
              type: "stream_error",
              message: "empty_upstream_response",
              streamRequested: true,
              durationMs: Date.now() - requestStart,
            });
            return;
          }
          await send({
            id,
            object: "chat.completion.chunk",
            created,
            model: model.id,
            choices: [
              {
                index: 0,
                delta: { content },
                finish_reason: null,
              },
            ],
          });
          await send({
            id,
            object: "chat.completion.chunk",
            created,
            model: model.id,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          });
        }
      } else {
        // ---- Normal streaming path ----
        const realStream = isRealStreamProvider(model.provider);
        if (realStream) {
          // Forward each upstream delta immediately (PRD §137). The first
          // delta is already in hand from the pre-flight — emit it now, then
          // continue pulling from the (already-opened) generator.
          let hasContent = false;
          if (firstDelta) {
            hasContent = true;
            await send({
              id,
              object: "chat.completion.chunk",
              created,
              model: model.id,
              choices: [
                {
                  index: 0,
                  delta: { content: firstDelta },
                  finish_reason: null,
                },
              ],
            });
          }
          for await (const delta of gen) {
            if (signal.aborted) break;
            if (delta) {
              hasContent = true;
              await send({
                id,
                object: "chat.completion.chunk",
                created,
                model: model.id,
                choices: [
                  {
                    index: 0,
                    delta: { content: delta },
                    finish_reason: null,
                  },
                ],
              });
            }
          }
          if (signal.aborted) {
            await writer.close();
            return;
          }
          if (!hasContent) {
            // R-5: refuse to pass on a silent empty stream. Emit the SSE
            // error event + terminal chunk with finish_reason:"error" +
            // [DONE] so a `Status: N/A` client can detect the failure.
            const emptyErr = emptyUpstreamResponseError(model.provider, model.id);
            hadError = true;
            await sendStreamError(emptyErr);
            providerHealthService.recordProviderFailure(model.provider, emptyErr);
            providerHealthService.recordModelFailure(canonicalOrLegacyId(model), emptyErr);
            metricsService.recordRequest({
              requestId,
              providerId: model.provider,
              modelId: model.id,
              status: 502,
              type: "stream_error",
              message: "empty_upstream_response",
              streamRequested: true,
              durationMs: Date.now() - requestStart,
            });
            return;
          }
          await send({
            id,
            object: "chat.completion.chunk",
            created,
            model: model.id,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          });
        } else {
          // Non-streaming provider: collect full text from the (already-
          // opened) generator — firstDelta is the first chunk, accumulate
          // the rest, then emit ONE content chunk + stop (PRD §137 — honest,
          // not fake).
          let fullText = firstDelta;
          for await (const delta of gen) {
            if (signal.aborted) break;
            if (delta) fullText += delta;
          }
          if (signal.aborted) {
            await writer.close();
            return;
          }
          if (!fullText.trim()) {
            // R-5: refuse to silently pass on an empty non-stream provider
            // response. Emit the error event + terminal chunk so streaming
            // clients can detect the failure (no more `content:""` + stop).
            const emptyErr = emptyUpstreamResponseError(model.provider, model.id);
            hadError = true;
            await sendStreamError(emptyErr);
            providerHealthService.recordProviderFailure(model.provider, emptyErr);
            providerHealthService.recordModelFailure(canonicalOrLegacyId(model), emptyErr);
            metricsService.recordRequest({
              requestId,
              providerId: model.provider,
              modelId: model.id,
              status: 502,
              type: "stream_error",
              message: "empty_upstream_response",
              streamRequested: true,
              durationMs: Date.now() - requestStart,
            });
            return;
          }
          // Honest non-fake-stream: split into word-ish tokens so the UI can
          // render incrementally even though the upstream yielded the whole
          // text in one delta.
          const tokens = fullText.match(/(\s+|\S+)/g) ?? [fullText];
          for (const token of tokens) {
            await send({
              id,
              object: "chat.completion.chunk",
              created,
              model: model.id,
              choices: [
                {
                  index: 0,
                  delta: { content: token },
                  finish_reason: null,
                },
              ],
            });
          }
          await send({
            id,
            object: "chat.completion.chunk",
            created,
            model: model.id,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          });
        }
      }
    } catch (err) {
      hadError = true;
      if (signal.aborted) {
        try {
          await writer.close();
        } catch {
          // ignore
        }
        return;
      }
      const ge = wrapUnknown(err, model.provider, model.id);
      // R-2 mid-stream: emit event:error + terminal chunk with
      // finish_reason:"error" before [DONE] (emitted in finally) so clients
      // parsing SSE can unambiguously detect the failure. The top-level
      // `http_status` field on the SSE error frame carries the real HTTP
      // status that would have been returned had this been non-streaming.
      await sendStreamError(ge);
      providerHealthService.recordProviderFailure(model.provider, err);
      providerHealthService.recordModelFailure(
        canonicalOrLegacyId(model),
        err,
      );
      metricsService.recordRequest({
        requestId,
        providerId: model.provider,
        modelId: model.id,
        status: ge.status,
        type: "stream_error",
        message: ge.message,
        streamRequested: true,
        durationMs: Date.now() - requestStart,
      });
    } finally {
      // R-2: always close with [DONE] so clients waiting on the sentinel
      // are released — even when the catch block already emitted a
      // terminal chunk (sseTerminalErrorChunk includes its own [DONE]
      // for safety; this one is best-effort in case the chunk failed).
      if (!hadError) {
        try {
          await enqueue("data: [DONE]\n\n");
        } catch {
          // best-effort
        }
      }
      try {
        await writer.close();
      } catch {
        // ignore
      }
      if (!hadError) {
        metricsService.recordRequest({
          requestId,
          providerId: model.provider,
          modelId: model.id,
          status: 200,
          type: "stream",
          message: "ok",
          streamRequested: true,
          durationMs: Date.now() - requestStart,
        });
      }
    }
  })();

  return new Response(readable, {
    headers: STREAM_HEADERS,
  });
}

/** Best-effort canonical id for a legacy GatewayModel (for health tracking). */
function canonicalOrLegacyId(model: GatewayModel): string {
  // Try the gateway catalog first.
  const parsed = parseCanonicalModelId(model.id);
  if (parsed) return model.id;
  // Otherwise check the catalog for a model with this legacy id as upstream.
  const catalog = catalogStore.getCatalog();
  const found = catalog.models.find((m) => m.upstreamId === model.upstream && m.providerId === model.provider);
  return found?.id ?? model.id;
}

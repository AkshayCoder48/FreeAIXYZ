/**
 * POST /api/v1/chat/completions — OpenAI-compatible chat completions.
 *
 * THE STREAMING FIX (PRD §137, §238):
 *   - Canonical ids (`fg/gpt-5`, `po/gpt-4o`, `oc/big-pickle`) go through the
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
  generateRequestId,
  isFailoverCandidate,
  metricsService,
  providerHealthService,
  providerRegistry,
  parseCanonicalModelId,
  STREAM_HEADERS,
  streamChat,
  sseErrorEvent,
  type ChatRequest,
  type DiscoveredModel,
  type FailoverCandidate,
  type ProviderAdapter,
} from "@/lib/gateway";
import { ensureGateway, resolveAdapterForModel } from "@/lib/gateway/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  // Web-search hint system message when not natively supported.
  // The gateway capabilities object doesn't expose webSearch (yet) so we
  // always inject the hint when web_search=true.
  if (wantsWebSearch) {
    out.push({
      role: "system",
      content:
        "The user has requested web-informed answers. If you have live web access via your backend, use it. Otherwise, answer based on your most recent knowledge and clearly note if information may be outdated.",
    });
  }
  if (useTools) {
    const skipSystemPrompt = model.providerId === "swarm";
    if (!skipSystemPrompt) {
      out.push({
        role: "system",
        content: buildToolSystemPrompt(body.tools!, body.tool_choice),
      });
    }
  }
  for (const m of body.messages) {
    const content = m.content;
    if (Array.isArray(content)) {
      // Drop image_url parts when the model lacks vision; keep text parts.
      const textParts = content
        .filter(
          (p: unknown) =>
            typeof p === "object" &&
            p !== null &&
            (p as Record<string, unknown>).type === "text",
        )
        .map(
          (p: unknown) =>
            ((p as Record<string, unknown>).text as string) ?? "",
        )
        .filter((t: string) => t !== "");
      // If the model has vision, also annotate image attachments.
      if (model.capabilities.vision) {
        const imageCount = content.filter(
          (p: unknown) =>
            typeof p === "object" &&
            p !== null &&
            (p as Record<string, unknown>).type === "image_url",
        ).length;
        const combined = textParts.join("\n");
        if (combined || imageCount > 0) {
          const note =
            imageCount > 0 ? `\n[image attached x${imageCount}]` : "";
          out.push({
            role: m.role === "assistant" ? "assistant" : m.role === "system" ? "system" : "user",
            content: combined + note,
          });
        }
      } else if (textParts.length > 0) {
        out.push({
          role: m.role === "assistant" ? "assistant" : m.role === "system" ? "system" : "user",
          content: textParts.join("\n"),
        });
      }
    } else {
      const text = messageToText(m);
      if (text !== null && text !== "") {
        const role: "system" | "user" | "assistant" =
          m.role === "assistant"
            ? "assistant"
            : m.role === "system"
              ? "system"
              : "user";
        out.push({ role, content: text });
      }
    }
  }
  return out;
}

/** POST /api/v1/chat/completions. */
export async function POST(request: Request) {
  await ensureGateway();

  let body: OAIChatCompletionRequest;
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

  const wantsStream = body.stream === true;
  const useTools = hasTools(body.tools);

  // ─── NEW GATEWAY PATH (canonical ids like fg/gpt-5, oc/big-pickle) ────────
  const resolved = resolveAdapterForModel(body.model);
  if (resolved) {
    return handleCanonicalRequest(body, request, resolved.model, resolved.adapter, useTools, wantsStream);
  }

  // ─── LEGACY FALLBACK (old-style ids like fgpt-gpt-5-5, oc-big-pickle) ─────
  return handleLegacyRequest(body, request, useTools, wantsStream);
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
  useTools: boolean,
  wantsStream: boolean,
): Promise<Response> {
  // Circuit-breaker check (PRD §121, §122).
  if (providerHealthService.isOpen(model.providerId)) {
    const err = new GatewayError({
      type: "PROVIDER_UNAVAILABLE",
      message: `Provider "${model.providerId}" is temporarily unavailable (circuit open). Retry later.`,
      provider: model.providerId,
      model: model.id,
    });
    return gatewayErrorResponse(err);
  }

  // ─── FreeAIXYZ special-proxy routing ─────────────────────────────────────
  // The FreeAIXYZ upstream (unlimitedai.org) is behind Cloudflare TLS
  // fingerprinting — plain Node fetch returns 403 (verified). The
  // freeaixyz-proxy route uses curl via child_process which bypasses the
  // fingerprint check. Route canonical `fx/<upstreamId>` ids through the
  // proxy too — the legacy adapter's fetch-based stream() cannot reach the
  // upstream successfully. (Same reasoning as the legacy `fxyz-*` ids
  // below.)
  if (model.providerId === "freeaixyz") {
    const origin = new URL(request.url).origin;
    const proxyRoute = "/api/v1/chat/freeaixyz-proxy";
    const proxyBody = {
      // Pass the canonical id — the proxy parses it back into the upstream id.
      model: body.model,
      messages: body.messages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : "",
      })),
      stream: wantsStream,
      tools: useTools ? body.tools : undefined,
      toolChoice: useTools
        ? typeof body.tool_choice === "string"
          ? body.tool_choice
          : "auto"
        : undefined,
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
      const proxyRes = await fetch(`${origin}${proxyRoute}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: wantsStream ? "text/event-stream" : "application/json",
        },
        body: JSON.stringify(proxyBody),
        signal: request.signal,
      });
      return new Response(proxyRes.body, {
        status: proxyRes.status,
        headers: proxyRes.headers,
      });
    } catch (err) {
      return gatewayErrorResponse(wrapUnknown(err, model.providerId, model.id));
    }
  }

  // Build normalized messages for the gateway contract.
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
    tools: useTools ? body.tools : undefined,
    toolChoice: typeof body.tool_choice === "string" ? body.tool_choice : undefined,
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
      const { response, timings } = streamChat(chatReq, adapter, fallbacks);
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
  try {
    const result = await adapter.complete(chatReq);
    text = result.text;
  } catch (err) {
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

  // Tool-call envelope parsing (prompt-injection approach).
  if (useTools && text !== null) {
    const parsed = parseToolCalls(text, generateToolCallId);
    if (parsed.toolCalls.length > 0) {
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
    const skipSystemPrompt = model.provider === "swarm";
    if (!skipSystemPrompt) {
      messages.push({
        role: "system",
        content: buildToolSystemPrompt(body.tools!, body.tool_choice),
      });
    }
  }
  for (const m of body.messages) {
    const content = m.content;
    if (Array.isArray(content) && !model.capabilities.vision) {
      const textParts = content
        .filter(
          (p: unknown) =>
            typeof p === "object" &&
            p !== null &&
            (p as Record<string, unknown>).type === "text",
        )
        .map(
          (p: unknown) => ((p as Record<string, unknown>).text as string) ?? "",
        )
        .filter((t: string) => t !== "");
      const combined = textParts.join("\n");
      if (combined) {
        messages.push({ role: m.role as ProviderMessage["role"], content: combined });
      }
    } else if (Array.isArray(content)) {
      const textParts = content
        .filter(
          (p: unknown) =>
            typeof p === "object" &&
            p !== null &&
            (p as Record<string, unknown>).type === "text",
        )
        .map(
          (p: unknown) => ((p as Record<string, unknown>).text as string) ?? "",
        )
        .filter((t: string) => t !== "");
      const combined = textParts.join("\n");
      if (combined) {
        messages.push({ role: m.role as ProviderMessage["role"], content: combined });
      }
    } else {
      const text = messageToText(m);
      if (text !== null && text !== "") {
        messages.push({ role: m.role as ProviderMessage["role"], content: text });
      }
    }
  }
  return messages;
}

/**
 * Extract the OpenAI sampling params from the request body (audit E1).
 * These are forwarded to OpenAI-compatible legacy providers (pollinations,
 * opencode, llm7, kilocode, vexa, gptoss, swarm). Custom-POST providers
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
  useTools: boolean,
  wantsStream: boolean,
): Promise<Response> {
  const model = resolveGatewayModel(body.model);
  if (!model) {
    // Unknown model — surface a clean MODEL_NOT_FOUND rather than routing
    // the request to an unrelated provider (the legacy behaviour forwarded
    // unknown ids to OpenCode as a passthrough, which surfaced as confusing
    // 401 "Model <id> is not supported" errors from the OpenCode upstream).
    return gatewayErrorResponse(
      new GatewayError({
        type: "MODEL_NOT_FOUND",
        message: `Model "${body.model}" was not found in the catalog. Check GET /api/v1/models for the list of available canonical ids (e.g. "fx/grok", "au/llama3-8b", "po/openai-fast").`,
        status: 404,
      }),
    );
  }
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
  if (model.provider === "freegpt" || model.provider === "freeaixyz") {
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
      tools: useTools ? body.tools : undefined,
      toolChoice: useTools
        ? typeof body.tool_choice === "string"
          ? body.tool_choice
          : "auto"
        : undefined,
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
      const proxyRes = await fetch(`${origin}${proxyRoute}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: wantsStream ? "text/event-stream" : "application/json",
        },
        body: JSON.stringify(proxyBody),
        signal: request.signal,
      });
      // Pass the response through as-is (preserves streaming OR JSON).
      return new Response(proxyRes.body, {
        status: proxyRes.status,
        headers: proxyRes.headers,
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
  const nativeTools = useTools ? body.tools : undefined;
  const nativeToolChoice = useTools
    ? typeof body.tool_choice === "string"
      ? body.tool_choice
      : "auto"
    : undefined;
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
  toolChoice: string | undefined,
  sampling: ReturnType<typeof extractSampling>,
): Promise<Response> {
  const requestStart = Date.now();
  const requestId = generateRequestId();
  let text: string;
  try {
    const result = await provider.complete({
      model,
      messages,
      tools: tools as ProviderTool[] | undefined,
      toolChoice,
      ...sampling,
    });
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

  const promptText = messages.map((m) => m.content).join("\n");
  if (useTools) {
    const parsed = parseToolCalls(text, generateToolCallId);
    if (parsed.toolCalls.length > 0) {
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
    "pollinations",
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
  toolChoice: string | undefined,
  sampling: ReturnType<typeof extractSampling>,
): Promise<Response> {
  const id = generateCompletionId();
  const created = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();
  const signal = request.signal;
  const requestId = generateRequestId();
  const requestStart = Date.now();

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
        let fullText = "";
        for await (const delta of provider.stream({
          model,
          messages,
          signal,
          tools: tools as ProviderTool[] | undefined,
          toolChoice,
          ...sampling,
        })) {
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
          const content = parsed.text || fullText || "(empty response)";
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
          // Forward each upstream delta immediately (PRD §137).
          let hasContent = false;
          for await (const delta of provider.stream({
            model,
            messages,
            signal,
            tools: tools as ProviderTool[] | undefined,
            toolChoice,
            ...sampling,
          })) {
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
          if (!hasContent) {
            await send({
              id,
              object: "chat.completion.chunk",
              created,
              model: model.id,
              choices: [
                {
                  index: 0,
                  delta: { content: "(empty response)" },
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
        } else {
          // Non-streaming provider: collect full text from provider.stream(),
          // emit ONE content chunk + stop (PRD §137 — honest, not fake).
          let fullText = "";
          for await (const delta of provider.stream({
            model,
            messages,
            signal,
            tools: tools as ProviderTool[] | undefined,
            toolChoice,
            ...sampling,
          })) {
            if (signal.aborted) break;
            if (delta) fullText += delta;
          }
          if (signal.aborted) {
            await writer.close();
            return;
          }
          if (!fullText) {
            await send({
              id,
              object: "chat.completion.chunk",
              created,
              model: model.id,
              choices: [
                {
                  index: 0,
                  delta: { content: "(empty response)" },
                  finish_reason: null,
                },
              ],
            });
          } else {
            await send({
              id,
              object: "chat.completion.chunk",
              created,
              model: model.id,
              choices: [
                {
                  index: 0,
                  delta: { content: fullText },
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
      try {
        await enqueue(sseErrorEvent(ge));
      } catch {
        // best-effort
      }
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
      try {
        await enqueue("data: [DONE]\n\n");
      } catch {
        // best-effort
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

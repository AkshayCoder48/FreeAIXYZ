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
  metricsService,
  providerHealthService,
  parseCanonicalModelId,
  STREAM_HEADERS,
  streamChat,
  sseErrorEvent,
  type ChatRequest,
  type DiscoveredModel,
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

  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
    return gatewayErrorResponse(
      new GatewayError({
        type: "INVALID_REQUEST",
        message: "`messages` is required and must be a non-empty array.",
      }),
    );
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
    maxTokens: body.max_tokens ?? undefined,
    tools: useTools ? body.tools : undefined,
    toolChoice: typeof body.tool_choice === "string" ? body.tool_choice : undefined,
  };

  if (wantsStream) {
    // Streaming path — streamChat returns a ready Response (the streaming fix).
    // Forwards every upstream delta immediately, no buffering/re-pacing.
    try {
      const { response, timings } = streamChat(chatReq, adapter);
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
  const requestStart = Date.now();
  const requestId = generateRequestId();
  try {
    const { text } = await adapter.complete(chatReq);
    providerHealthService.recordProviderSuccess(adapter.id);
    providerHealthService.recordModelSuccess(model.id);
    metricsService.recordRequest({
      requestId,
      providerId: adapter.id,
      modelId: model.id,
      status: 200,
      type: "complete",
      message: "ok",
      streamRequested: false,
      durationMs: Date.now() - requestStart,
    });

    const promptText = messages.map((m) => m.content).join("\n");

    // Tool-call envelope parsing (prompt-injection approach).
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
  } catch (err) {
    const ge = wrapUnknown(err, adapter.id, model.id);
    providerHealthService.recordProviderFailure(adapter.id, err);
    providerHealthService.recordModelFailure(model.id, err);
    metricsService.recordRequest({
      requestId,
      providerId: adapter.id,
      modelId: model.id,
      status: ge.status,
      type: "complete_error",
      message: ge.message,
      streamRequested: false,
      durationMs: Date.now() - requestStart,
    });
    return gatewayErrorResponse(ge);
  }
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
        message: `Model "${body.model}" was not found in the catalog. Check /v1/models for the list of available canonical ids (e.g. "au/llama3-8b", "fg/gpt-4o-mini").`,
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

  if (wantsStream) {
    return legacyStreamCompletion(
      model,
      provider,
      messages,
      useTools,
      request,
      nativeTools,
      nativeToolChoice,
    );
  }
  return legacyJsonCompletion(
    model,
    provider,
    messages,
    useTools,
    nativeTools,
    nativeToolChoice,
  );
}

/** Non-streaming legacy completion — uses adapter.complete, wraps errors. */
async function legacyJsonCompletion(
  model: GatewayModel,
  provider: ReturnType<typeof getProvider>,
  messages: ProviderMessage[],
  useTools: boolean,
  tools?: unknown[],
  toolChoice?: string,
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
  tools?: unknown[],
  toolChoice?: string,
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

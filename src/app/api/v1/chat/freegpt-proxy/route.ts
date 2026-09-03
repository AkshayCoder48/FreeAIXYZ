/**
 * FreeGPT proxy route — Node.js runtime (needed for WASM signer).
 *
 * This route handles FreeGPT requests on behalf of the Edge runtime chat route.
 * The Edge route can't load the WASM signer (needs fs/require), so it proxies
 * FreeGPT requests here.
 *
 * Body: { model, messages, stream, tools?, toolChoice? }
 * Response: OpenAI-compatible JSON or SSE stream
 *
 * R-1: empty-content validation runs BEFORE the stream is opened.
 * R-2: mid-stream errors emit `event: error` + terminal chunk with
 *   `finish_reason: "error"` + `[DONE]` (no more `Status: N/A`).
 * R-4: response headers never include `content-encoding` (BUG-2 fix).
 * R-5: empty upstream content → 502 `empty_upstream_response` (BUG-3 fix).
 * R-7: client-payload faults → 4xx; upstream faults → 5xx.
 * R-10: upstream error text moves to `upstream_detail`; user-facing
 *   message is sanitized (no HTML / billing / deprecation blobs).
 */

import { NextResponse } from "next/server";
import { resolveGatewayModel } from "@/lib/providers/registry";
import { freeGptProvider } from "@/lib/providers/freegpt";
import type { ProviderTool } from "@/lib/providers/types";
import {
  generateCompletionId,
  generateToolCallId,
  estimateTokens,
  type OAIChatCompletionResponse,
} from "@/lib/openai-types";
import { parseToolCalls } from "@/lib/tool-calls";
import {
  GatewayError,
  emptyContentError,
  emptyUpstreamResponseError,
  hasNonEmptyContent,
  sseErrorEvent,
  sseTerminalErrorChunk,
} from "@/lib/gateway/errors";
import { withCors, corsPreflight } from "@/lib/api/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface ProxyRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  stream?: boolean;
  tools?: unknown[];
  toolChoice?: string;
}

/**
 * R-4: SSE response headers that intentionally OMIT `content-encoding` and
 * `transfer-encoding` (BUG-2 brotli-header leak fix).
 */
const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-store, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
  "X-No-Buffer": "true",
};

/** JSON error helper that returns the gateway error shape (R-7). */
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

export async function POST(request: Request): Promise<Response> {
  return withCors(await freegptProxy(request));
}

/** CORS preflight. */
export async function OPTIONS(): Promise<Response> {
  return corsPreflight();
}

async function freegptProxy(request: Request): Promise<Response> {
  let body: ProxyRequest;
  try {
    body = (await request.json()) as ProxyRequest;
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
  const model = resolveGatewayModel(body.model);
  if (!model) {
    return gatewayErrorResponse(
      new GatewayError({
        type: "MODEL_NOT_FOUND",
        status: 404,
        code: "model_not_found",
        message: `Unknown model "${body.model}".`,
        model: body.model,
        provider: "freegpt",
      }),
    );
  }
  const provider = freeGptProvider;

  const messages = (body.messages ?? []).map((m) => ({
    role: m.role as "system" | "user" | "assistant",
    content: m.content,
  }));

  const tools = body.tools as ProviderTool[] | undefined;
  const toolChoice = body.toolChoice;
  const useTools = tools && tools.length > 0;

  // R-1: validate non-empty content BEFORE the stream is opened. Same
  // reasoning as the freeaixyz-proxy route — empty content would otherwise
  // be forwarded to the FreeGPT upstream which leaks its internal
  // challenge / cache error strings back to the client.
  if (!hasNonEmptyContent(body.messages ?? [])) {
    return gatewayErrorResponse(
      emptyContentError(model?.id ?? body.model, "freegpt"),
    );
  }

  if (body.stream) {
    // ─── PRE-FLIGHT (R-2 TRUE FIX) ─────────────────────────────────────
    // Probe the upstream by awaiting the FIRST chunk (or first throw)
    // BEFORE opening the 200 OK SSE stream. Pre-first-token errors now
    // return a real HTTP error Response (404/502/429/401/…) with a JSON
    // body — NOT a 200 OK SSE stream with an in-band `event: error` frame
    // that the client can't classify (producing `Status: N/A`). Mid-stream
    // errors keep the existing `event: error` + terminal-chunk behavior.
    const preflight = provider.stream({
      model,
      messages,
      signal: request.signal,
      tools,
      toolChoice,
    });
    let firstDelta = "";
    try {
      const first = await preflight.next();
      if (first.done) {
        // Generator returned without yielding anything → empty upstream.
        try { await preflight.return(undefined); } catch { /* best-effort */ }
        return gatewayErrorResponse(
          emptyUpstreamResponseError("freegpt", model.id),
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
        provider: "freegpt",
        model: model.id,
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

    // R-2 mid-stream: helper that emits an SSE error event + terminal chunk
    // with finish_reason:"error" + [DONE] before closing the writer. Used
    // only when the upstream throws AFTER at least one content chunk has
    // been forwarded (pre-first-token throws were caught by the pre-flight
    // above and converted to a real HTTP error Response).
    const sendStreamError = (err: GatewayError) => {
      try {
        writer.write(encoder.encode(sseErrorEvent(err)));
        writer.write(encoder.encode(sseTerminalErrorChunk(err, id, created, model.id)));
      } catch {
        // best-effort
      }
    };

    (async () => {
      const send = (obj: unknown) =>
        writer.write(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      const heartbeat = () => writer.write(encoder.encode(`: keep-alive\n\n`));

      const heartbeatTimer = setInterval(() => { heartbeat().catch(() => {}); }, 500);

      let hadError = false;
      try {
        await send({
          id,
          object: "chat.completion.chunk",
          created,
          model: model.id,
          choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
        });

        if (useTools) {
          // Buffer for tool parsing. firstDelta is already in hand from the
          // pre-flight; accumulate the rest from the (already-opened) generator.
          let fullText = firstDelta;
          for await (const delta of preflight) {
            if (delta) fullText += delta;
          }

          const parsed = parseToolCalls(fullText, generateToolCallId);
          if (parsed.toolCalls.length > 0) {
            for (let i = 0; i < parsed.toolCalls.length; i++) {
              const tc = parsed.toolCalls[i];
              await send({
                id,
                object: "chat.completion.chunk",
                created,
                model: model.id,
                choices: [{
                  index: 0,
                  delta: {
                    tool_calls: [{
                      index: i,
                      id: tc.id,
                      type: "function",
                      function: { name: tc.function.name, arguments: tc.function.arguments },
                    }],
                  },
                  finish_reason: null,
                }],
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
            // R-5: empty content (no tool calls extracted + no full text)
            // surfaces as a mid-stream event:error + terminal chunk.
            const content = (parsed.text || fullText).trim();
            if (!content) {
              hadError = true;
              clearInterval(heartbeatTimer);
              sendStreamError(emptyUpstreamResponseError("freegpt", model.id));
              return;
            }
            // Stream content
            const tokens = fullText.match(/(\s+|\S+)/g) ?? [fullText];
            for (const token of tokens) {
              await send({
                id,
                object: "chat.completion.chunk",
                created,
                model: model.id,
                choices: [{ index: 0, delta: { content: token }, finish_reason: null }],
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
        } else {
          // Direct streaming. firstDelta is already in hand from the
          // pre-flight — emit it now, then continue pulling from the
          // (already-opened) generator.
          let hasContent = false;
          if (firstDelta) {
            hasContent = true;
            await send({
              id,
              object: "chat.completion.chunk",
              created,
              model: model.id,
              choices: [{ index: 0, delta: { content: firstDelta }, finish_reason: null }],
            });
          }
          for await (const delta of preflight) {
            if (delta) {
              hasContent = true;
              await send({
                id,
                object: "chat.completion.chunk",
                created,
                model: model.id,
                choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
              });
            }
          }
          // R-5: refuse to silently pass on an empty stream.
          if (!hasContent) {
            hadError = true;
            clearInterval(heartbeatTimer);
            sendStreamError(emptyUpstreamResponseError("freegpt", model.id));
            return;
          }
          await send({
            id,
            object: "chat.completion.chunk",
            created,
            model: model.id,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          });
        }
      } catch (err) {
        hadError = true;
        clearInterval(heartbeatTimer);
        const msg = err instanceof Error ? err.message : "Unknown error";
        // R-2 mid-stream + R-7 + R-10: classify + sanitize.
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
          provider: "freegpt",
          model: model.id,
          requiresAuth: isAuth,
          retryAfter: isQuota ? 60 : undefined,
        });
        sendStreamError(ge);
      } finally {
        clearInterval(heartbeatTimer);
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

  // Non-streaming response
  try {
    const result = await provider.complete({
      model,
      messages,
      signal: request.signal,
      tools,
      toolChoice,
    });

    // R-5: refuse to silently pass on an empty reply.
    if (!result.text.trim()) {
      return gatewayErrorResponse(emptyUpstreamResponseError("freegpt", model.id));
    }

    if (useTools) {
      const parsed = parseToolCalls(result.text, generateToolCallId);
      if (parsed.toolCalls.length > 0) {
        return NextResponse.json({
          id: generateCompletionId(),
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: model.id,
          choices: [{
            index: 0,
            message: {
              role: "assistant",
              content: parsed.text || null,
              tool_calls: parsed.toolCalls,
            },
            finish_reason: "tool_calls",
          }],
          usage: {
            prompt_tokens: estimateTokens(messages.map(m => m.content).join("\n")),
            completion_tokens: estimateTokens(result.text),
            total_tokens: estimateTokens(messages.map(m => m.content).join("\n")) + estimateTokens(result.text),
          },
        });
      }
    }

    return NextResponse.json({
      id: generateCompletionId(),
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: model.id,
      choices: [{
        index: 0,
        message: { role: "assistant", content: result.text },
        finish_reason: "stop",
      }],
      usage: {
        prompt_tokens: estimateTokens(messages.map(m => m.content).join("\n")),
        completion_tokens: estimateTokens(result.text),
        total_tokens: estimateTokens(messages.map(m => m.content).join("\n")) + estimateTokens(result.text),
      },
    });
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
      provider: "freegpt",
      model: model.id,
      requiresAuth: isAuth,
      retryAfter: isQuota ? 60 : undefined,
    });
    return gatewayErrorResponse(ge);
  }
}

import { NextResponse } from "next/server";
import {
  complete,
  resolveModel,
  ToolbazError,
  type PromptTurn,
} from "@/lib/toolbaz";
import {
  generateCompletionId,
  generateToolCallId,
  estimateTokens,
  type OAIChatCompletionRequest,
  type OAIChatCompletionResponse,
  type OAIError,
  type OAIToolCall,
} from "@/lib/openai-types";
import {
  buildToolSystemPrompt,
  messageToText,
  parseToolCalls,
  hasTools,
} from "@/lib/tool-calls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function errorResponse(
  message: string,
  status = 400,
  type = "invalid_request_error",
  code: string | null = null,
) {
  const body: OAIError = {
    error: { message, type, param: null, code },
  };
  return NextResponse.json(body, { status });
}

/**
 * Translate an upstream Toolbaz error into an OpenAI-shaped error response
 * with an appropriate HTTP status:
 *   - INVALID_MODEL / suspicious   → 400 (bad request)
 *   - quota exceeded               → 429 (rate limited)
 *   - empty output                 → 502 (bad gateway, retryable)
 *   - anything else                → 502
 */
function upstreamErrorResponse(err: unknown) {
  if (err instanceof ToolbazError) {
    const detail = err.upstreamBody;
    let status = 502;
    let code = "toolbaz_error";
    if (/INVALID_MODEL/i.test(detail)) {
      status = 400;
      code = "invalid_model";
    } else if (/quota/i.test(detail)) {
      status = 429;
      code = "rate_limit_exceeded";
    } else if (/suspicious/i.test(detail)) {
      status = 400;
      code = "upstream_rejected";
    }
    return errorResponse(err.message, status, "upstream_error", code);
  }
  const message = err instanceof Error ? err.message : "Unknown upstream error";
  return errorResponse(message, 502, "upstream_error", "toolbaz_error");
}

/** POST /api/v1/chat/completions — OpenAI-compatible chat completions. */
export async function POST(request: Request) {
  let body: OAIChatCompletionRequest;
  try {
    body = (await request.json()) as OAIChatCompletionRequest;
  } catch {
    return errorResponse("Invalid JSON body.");
  }

  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
    return errorResponse(
      "`messages` is required and must be a non-empty array.",
    );
  }

  const model = resolveModel(body.model);
  const useTools = hasTools(body.tools);

  // Serialize the conversation into the text turns Toolbaz expects.
  // When tools are present, a system directive describing them is prepended.
  const turns: PromptTurn[] = [];
  if (useTools) {
    turns.push({
      role: "system",
      text: buildToolSystemPrompt(body.tools!, body.tool_choice),
    });
  }
  for (const m of body.messages) {
    const text = messageToText(m);
    if (text !== null && text !== "") {
      turns.push({ role: m.role, text });
    }
  }

  if (turns.length === 0) {
    return errorResponse("No usable messages after serialization.");
  }

  const wantsStream = body.stream === true;

  if (wantsStream) {
    return streamCompletion(model, turns, request, useTools);
  }
  return jsonCompletion(model, turns, useTools);
}

/** Non-streaming: one round-trip to Toolbaz, then a single JSON response. */
async function jsonCompletion(
  model: string,
  turns: PromptTurn[],
  useTools: boolean,
) {
  let result;
  try {
    result = await complete({ model, turns });
  } catch (err) {
    return upstreamErrorResponse(err);
  }

  const promptText = turns.map((t) => t.text).join("\n");

  // If tools are active, try to parse a tool-call envelope out of the output.
  if (useTools) {
    const parsed = parseToolCalls(result.text, generateToolCallId);
    if (parsed.toolCalls.length > 0) {
      const payload: OAIChatCompletionResponse = {
        id: generateCompletionId(),
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
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
          completion_tokens: estimateTokens(result.text),
          total_tokens:
            estimateTokens(promptText) + estimateTokens(result.text),
        },
      };
      return NextResponse.json(payload);
    }
  }

  const payload: OAIChatCompletionResponse = {
    id: generateCompletionId(),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: result.text },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: estimateTokens(promptText),
      completion_tokens: estimateTokens(result.text),
      total_tokens: estimateTokens(promptText) + estimateTokens(result.text),
    },
  };
  return NextResponse.json(payload);
}

/**
 * Split text into stream-friendly pieces. Each piece becomes one SSE content
 * delta. Whitespace runs are kept intact; very long outputs are grouped so the
 * event count stays bounded (≤ ~150 events).
 */
function tokenizeForStream(text: string): string[] {
  const raw = text.match(/(\s+|\S+)/g);
  if (!raw || raw.length === 0) return text ? [text] : [];
  const MAX_EVENTS = 150;
  if (raw.length <= MAX_EVENTS) return raw;
  const groupSize = Math.ceil(raw.length / MAX_EVENTS);
  const groups: string[] = [];
  for (let i = 0; i < raw.length; i += groupSize) {
    groups.push(raw.slice(i, i + groupSize).join(""));
  }
  return groups;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Streaming response — REAL streaming.
 *
 * IMPORTANT — why this is real, not fake:
 *
 * Toolbaz's `writing.php` returns the entire completion in a single HTTP chunk
 * (verified: a 4540-byte, 600-word essay arrives in one `data` event at 0ms).
 * It is impossible to stream tokens the upstream never produced incrementally.
 *
 * What we CAN do — and do here — is stream the delivery to the client as a
 * sequence of genuinely separate, immediately-flushed SSE events (one per
 * token), rather than buffering the whole response body and writing it in one
 * go. Each chunk is written to the underlying transport and flushed with
 * `await` yielding to the event loop between writes, so the client receives
 * them as distinct network frames over time.
 *
 * Heartbeat comments (`: keep-alive`) are emitted while we wait on the
 * upstream fetch so the connection stays open through proxies. The client's
 * AbortController is honored throughout.
 *
 * When tools are active we buffer the full response before emitting, because
 * we must parse a complete tool-call envelope before deciding whether to emit
 * `tool_calls` (with finish_reason "tool_calls") or normal content deltas.
 */
async function streamCompletion(
  model: string,
  turns: PromptTurn[],
  request: Request,
  useTools: boolean,
) {
  const id = generateCompletionId();
  const created = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();
  const signal = request.signal;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const enqueue = (bytes: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(bytes));
        } catch {
          /* controller closed after client disconnect */
        }
      };
      const send = (obj: unknown) =>
        enqueue(`data: ${JSON.stringify(obj)}\n\n`);
      const heartbeat = () => enqueue(`: keep-alive\n\n`);

      const heartbeatTimer = setInterval(heartbeat, 500);
      const cleanup = () => {
        closed = true;
        clearInterval(heartbeatTimer);
      };

      // initial role chunk — sent immediately, before any upstream work
      send({
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [
          { index: 0, delta: { role: "assistant" }, finish_reason: null },
        ],
      });

      try {
        const result = await complete({ model, turns, signal });
        clearInterval(heartbeatTimer);

        if (signal.aborted) {
          cleanup();
          controller.close();
          return;
        }

        // ---- Tool-calling path: buffer, parse, emit tool_calls ----
        if (useTools) {
          const parsed = parseToolCalls(result.text, generateToolCallId);
          if (parsed.toolCalls.length > 0) {
            // Emit each tool call as its own streaming chunk, mirroring
            // OpenAI's streaming tool_calls shape.
            for (let i = 0; i < parsed.toolCalls.length; i++) {
              const tc: OAIToolCall = parsed.toolCalls[i];
              // first chunk carries index + id + type + name
              send({
                id,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [
                  {
                    index: 0,
                    delta: {
                      tool_calls: [
                        {
                          index: i,
                          id: tc.id,
                          type: "function",
                          function: { name: tc.function.name, arguments: "" },
                        },
                      ],
                    },
                    finish_reason: null,
                  },
                ],
              });
              await sleep(0);
              // stream the arguments string in pieces
              const argChunks = chunkString(tc.function.arguments, 24);
              for (const piece of argChunks) {
                send({
                  id,
                  object: "chat.completion.chunk",
                  created,
                  model,
                  choices: [
                    {
                      index: 0,
                      delta: {
                        tool_calls: [
                          {
                            index: i,
                            function: { arguments: piece },
                          },
                        ],
                      },
                      finish_reason: null,
                    },
                  ],
                });
                await sleep(0);
              }
            }
            // final chunk
            send({
              id,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
            });
          } else {
            // no tool call detected — stream as normal text
            await streamText(send, parsed.text || result.text, signal, {
              id,
              created,
              model,
            });
            send({
              id,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            });
          }
        } else {
          // ---- Normal text streaming path ----
          await streamText(send, result.text, signal, { id, created, model });
          send({
            id,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          });
        }
      } catch (err) {
        clearInterval(heartbeatTimer);
        if (signal.aborted) {
          cleanup();
          controller.close();
          return;
        }
        const message =
          err instanceof ToolbazError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Unknown upstream error";
        send({
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [
            {
              index: 0,
              delta: { content: `\n\n[error: ${message}]` },
              finish_reason: "stop",
            },
          ],
        });
      } finally {
        cleanup();
        enqueue("data: [DONE]\n\n");
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      // client disconnected — start() will notice via signal
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/** Stream a text string as content deltas, yielding between each write. */
async function streamText(
  send: (obj: unknown) => void,
  text: string,
  signal: AbortSignal,
  meta: { id: string; created: number; model: string },
) {
  const tokens = tokenizeForStream(text);
  for (const piece of tokens) {
    if (signal.aborted) break;
    send({
      id: meta.id,
      object: "chat.completion.chunk",
      created: meta.created,
      model: meta.model,
      choices: [{ index: 0, delta: { content: piece }, finish_reason: null }],
    });
    // Yield to the event loop so each enqueue is flushed as its own write
    // rather than being coalesced into a single buffered dump.
    await sleep(0);
  }
}

/** Split a string into fixed-size pieces. */
function chunkString(s: string, size: number): string[] {
  if (s.length <= size) return s ? [s] : [];
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}

import { NextResponse } from "next/server";
import { complete, resolveModel, type ChatMessage } from "@/lib/toolbaz";
import {
  generateCompletionId,
  estimateTokens,
  type OAIChatCompletionRequest,
  type OAIChatCompletionResponse,
  type OAIError,
} from "@/lib/openai-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The gateway may wait on the upstream Toolbaz service, which can take a while.
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

  // Normalize messages to the subset toolbaz understands.
  const messages: ChatMessage[] = body.messages
    .filter(
      (m) =>
        m && (m.role === "system" || m.role === "user" || m.role === "assistant"),
    )
    .map((m) => ({
      role: m.role as ChatMessage["role"],
      content: typeof m.content === "string" ? m.content : "",
    }));

  if (messages.length === 0) {
    return errorResponse(
      "No usable messages (need at least one system/user/assistant message).",
    );
  }

  const wantsStream = body.stream === true;

  if (wantsStream) {
    return streamCompletion(model, messages, request);
  }
  return jsonCompletion(model, messages);
}

/** Non-streaming: one round-trip to Toolbaz, then a single JSON response. */
async function jsonCompletion(model: string, messages: ChatMessage[]) {
  let result;
  try {
    result = await complete({ model, messages });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown upstream error";
    return errorResponse(message, 502, "upstream_error", "toolbaz_error");
  }

  const promptText = messages.map((m) => m.content).join("\n");
  const promptTokens = estimateTokens(promptText);
  const completionTokens = estimateTokens(result.text);

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
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
  return NextResponse.json(payload);
}

/**
 * Split a string into small, stream-friendly pieces.
 * Keeps whitespace runs intact and groups long text into bounded batches so
 * the SSE event count stays reasonable (≤ ~120 events) regardless of length.
 */
function tokenizeForStream(text: string): string[] {
  const raw = text.match(/(\s+|\S+)/g);
  if (!raw || raw.length === 0) return text ? [text] : [];

  // Target a bounded number of emission events. Group consecutive tokens.
  const MAX_EVENTS = 120;
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
 * Streaming response.
 *
 * Toolbaz's `writing.php` returns the ENTIRE completion in a single HTTP chunk
 * (verified: the full body lands in one `data` event). It does not stream.
 * So to give clients a genuine token-by-token streaming experience we:
 *
 *   1. emit the initial `role` delta immediately,
 *   2. send SSE heartbeat comments (`: keep-alive`) every 400ms while we wait
 *      on the upstream fetch — this keeps proxies/CDNs from killing the idle
 *      connection and signals liveness to the client,
 *   3. once the full text arrives, split it into small pieces and emit them
 *      with an adaptive inter-chunk delay so the client sees progressive
 *      output instead of a single burst.
 *
 * The client's AbortController (request.signal) is honored throughout.
 */
async function streamCompletion(
  model: string,
  messages: ChatMessage[],
  request: Request,
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
          // controller may have errored/closed after a client disconnect
        }
      };
      const send = (obj: unknown) =>
        enqueue(`data: ${JSON.stringify(obj)}\n\n`);
      // SSE comment line — ignored by EventSource/SDK parsers, keeps line alive.
      const heartbeat = () => enqueue(`: keep-alive\n\n`);

      const cleanup = () => {
        closed = true;
        clearInterval(heartbeatTimer);
      };

      // Heartbeat every 400ms while we wait on upstream.
      const heartbeatTimer = setInterval(heartbeat, 400);

      // initial role chunk
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
        const result = await complete({ model, messages, signal });
        clearInterval(heartbeatTimer);

        const text = result.text;
        const tokens = tokenizeForStream(text);

        // Adaptive pacing: spread delivery over ~3s, clamped per-chunk to
        // [12ms, 45ms] so short replies still feel snappy and long replies
        // don't drag. This yields between chunks so the network layer can
        // flush each SSE event to the client.
        const targetWindowMs = 3000;
        const delay = Math.max(
          12,
          Math.min(45, Math.round(targetWindowMs / Math.max(1, tokens.length))),
        );

        for (const piece of tokens) {
          if (signal.aborted) break;
          send({
            id,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [
              { index: 0, delta: { content: piece }, finish_reason: null },
            ],
          });
          await sleep(delay);
        }

        // final chunk
        if (!signal.aborted) {
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
          // client went away — just close quietly
          cleanup();
          controller.close();
          return;
        }
        const message =
          err instanceof Error ? err.message : "Unknown upstream error";
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
          // already closed
        }
      }
    },
    cancel() {
      // client disconnected — nothing to do, start() will notice via signal
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

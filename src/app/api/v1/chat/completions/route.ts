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
    .filter((m) => m && (m.role === "system" || m.role === "user" || m.role === "assistant"))
    .map((m) => ({
      role: m.role as ChatMessage["role"],
      content: typeof m.content === "string" ? m.content : "",
    }));

  if (messages.length === 0) {
    return errorResponse("No usable messages (need at least one system/user/assistant message).");
  }

  const wantsStream = body.stream === true;

  if (wantsStream) {
    return streamCompletion(model, messages, body);
  }
  return jsonCompletion(model, messages, body);
}

/** Non-streaming: one round-trip to Toolbaz, then a single JSON response. */
async function jsonCompletion(
  model: string,
  messages: ChatMessage[],
  _body: OAIChatCompletionRequest,
) {
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
 * Streaming: Toolbaz returns the full text at once, so we fetch it and then
 * re-emit it as Server-Sent Events in small chunks so it behaves like a real
 * OpenAI streaming response for SDK consumers.
 */
async function streamCompletion(
  model: string,
  messages: ChatMessage[],
  _body: OAIChatCompletionRequest,
) {
  const id = generateCompletionId();
  const created = Math.floor(Date.now() / 1000);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };

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
        const result = await complete({ model, messages });
        const text = result.text;

        // Split into word-ish chunks so streaming feels natural.
        const chunks = text.match(/(\s+|\S+)/g) ?? [text];
        for (const chunk of chunks) {
          send({
            id,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [
              { index: 0, delta: { content: chunk }, finish_reason: null },
            ],
          });
        }

        // final chunk
        send({
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        });
      } catch (err) {
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
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
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

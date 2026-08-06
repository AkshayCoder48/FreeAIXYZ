/**
 * FreeGPT proxy route — Node.js runtime (needed for WASM signer).
 *
 * This route handles FreeGPT requests on behalf of the Edge runtime chat route.
 * The Edge route can't load the WASM signer (needs fs/require), so it proxies
 * FreeGPT requests here.
 *
 * Body: { model, messages, stream, tools?, toolChoice? }
 * Response: OpenAI-compatible JSON or SSE stream
 */

import { NextResponse } from "next/server";
import { resolveGatewayModel, getProvider } from "@/lib/providers";
import type { ProviderTool } from "@/lib/providers/types";
import {
  generateCompletionId,
  generateToolCallId,
  estimateTokens,
  type OAIChatCompletionResponse,
} from "@/lib/openai-types";
import { parseToolCalls } from "@/lib/tool-calls";

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

export async function POST(request: Request) {
  const body = (await request.json()) as ProxyRequest;
  const model = resolveGatewayModel(body.model);
  const provider = getProvider("freegpt");

  const messages = body.messages.map((m) => ({
    role: m.role as "system" | "user" | "assistant",
    content: m.content,
  }));

  const tools = body.tools as ProviderTool[] | undefined;
  const toolChoice = body.toolChoice;
  const useTools = tools && tools.length > 0;

  if (body.stream) {
    // Streaming response
    const encoder = new TextEncoder();
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const id = generateCompletionId();
    const created = Math.floor(Date.now() / 1000);

    (async () => {
      const send = (obj: unknown) =>
        writer.write(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      try {
        await send({
          id,
          object: "chat.completion.chunk",
          created,
          model: model.id,
          choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
        });

        if (useTools) {
          // Buffer for tool parsing
          let fullText = "";
          for await (const delta of provider.stream({
            model,
            messages,
            signal: request.signal,
            tools,
            toolChoice,
          })) {
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
          // Direct streaming
          let hasContent = false;
          for await (const delta of provider.stream({
            model,
            messages,
            signal: request.signal,
            tools,
            toolChoice,
          })) {
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
          if (!hasContent) {
            await send({
              id,
              object: "chat.completion.chunk",
              created,
              model: model.id,
              choices: [{ index: 0, delta: { content: "(empty response)" }, finish_reason: null }],
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
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        await send({
          id,
          object: "chat.completion.chunk",
          created,
          model: model.id,
          choices: [{ index: 0, delta: { content: `\n\n[error: ${msg}]` }, finish_reason: "stop" }],
        });
      } finally {
        await writer.write(encoder.encode("data: [DONE]\n\n"));
        try { await writer.close(); } catch {}
      }
    })();

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
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
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: { message: msg, type: "upstream_error" } },
      { status: 502 },
    );
  }
}

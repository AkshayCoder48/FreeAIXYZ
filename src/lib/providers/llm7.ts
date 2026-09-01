/**
 * LLM7.io provider.
 *
 * Free, no-auth API. 3 models work anonymously (gpt-oss:20b, minimax-m2.7,
 * codestral-latest). Others require a token from dash.llm7.io.
 *
 * Endpoint: POST https://api.llm7.io/v1/chat/completions
 * Response: standard OpenAI SSE
 */

import type { Provider, ProviderCompletionRequest } from "./types";
import { assertToolsForwarded } from "@/lib/tools/forwarding";

const ENDPOINT = "https://api.llm7.io/v1/chat/completions";

function parseSseLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const data = trimmed.slice(5).trim();
  if (!data || data === "[DONE]") return null;
  try {
    const json = JSON.parse(data);
    const choice = json?.choices?.[0];
    if (!choice) return null;
    const content = choice.delta?.content;
    if (typeof content === "string" && content) return content;
    const toolCalls = choice.delta?.tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      const formatted = toolCalls.map((tc: { function?: { name?: string; arguments?: string } }) => ({
        name: tc.function?.name || "",
        arguments: tc.function?.arguments || "",
      }));
      return JSON.stringify({ __tool_calls: formatted });
    }
    // Task 4 fix (v4): yield delta.reasoning as content. LLM7.io routes
    // through OpenRouter's free model pool, which emits the model's
    // chain-of-thought in `delta.reasoning` BEFORE the final answer in
    // `delta.content`. Same fix as kilocode.ts — without this, the
    // adapter yields nothing during the (potentially long) reasoning
    // phase → the gateway's pre-flight times out → 502
    // empty_upstream_response. Yielding reasoning content keeps the
    // stream alive and surfaces the model's thinking to the client.
    const reasoning = choice.delta?.reasoning;
    if (typeof reasoning === "string" && reasoning) return reasoning;
    return null;
  } catch {
    return null;
  }
}

export const llm7Provider: Provider = {
  id: "llm7",

  async complete(req) {
    let text = "";
    for await (const chunk of this.stream(req)) {
      text += chunk;
    }
    return { text };
  },

  async *stream(req) {
    const payload: Record<string, unknown> = {
      model: req.model.upstream,
      messages: req.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: true,
    };
    // Forward OpenAI sampling params (audit E1).
    if (req.maxTokens !== undefined) payload.max_tokens = req.maxTokens;
    if (req.temperature !== undefined) payload.temperature = req.temperature;
    if (req.topP !== undefined) payload.top_p = req.topP;
    if (req.stop !== undefined) payload.stop = req.stop;
    if (req.seed !== undefined) payload.seed = req.seed;
    if (req.presencePenalty !== undefined) payload.presence_penalty = req.presencePenalty;
    if (req.frequencyPenalty !== undefined) payload.frequency_penalty = req.frequencyPenalty;
    if (req.n !== undefined) payload.n = req.n;
    if (req.tools && req.tools.length > 0) {
      payload.tools = req.tools;
      payload.tool_choice = req.toolChoice ?? "auto";
    }
    if (req.parallelToolCalls !== undefined) {
      payload.parallel_tool_calls = req.parallelToolCalls;
    }
    // Tool PRD §20 — prove tools survived into the provider payload.
    assertToolsForwarded(payload, req.tools, "llm7", req.model.upstream);

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: req.signal,
    });

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => "");
      throw new Error(`LLM7.io returned HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const delta = parseSseLine(line);
          if (delta) yield delta;
        }
      }
      const delta = parseSseLine(buffer);
      if (delta) yield delta;
    } finally {
      reader.releaseLock();
    }
  },
};

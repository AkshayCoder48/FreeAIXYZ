/**
 * GPT-OSS provider — OpenAI-compatible API with reasoning support.
 *
 * Endpoint: POST https://broken-water-d859.junioralive.workers.dev/v1/chat/completions
 * Models:   gpt-oss-120b (large, reasoning), gpt-oss-20b (fast)
 *
 * OpenAI-compatible SSE streaming with:
 *   - reasoning_content in delta (chain-of-thought)
 *   - X-Reasoning-Effort header (none|low|medium|high)
 *   - No API key required
 *
 * Credit: GPT-OSS (https://broken-water-d859.junioralive.workers.dev)
 */

import type { Provider, ProviderCompletionRequest } from "./types";
import { assertToolsForwarded } from "@/lib/tools/forwarding";

const ENDPOINT = "https://broken-water-d859.junioralive.workers.dev/v1/chat/completions";

interface GptOssDelta {
  choices?: {
    delta?: {
      content?: string;
      reasoning_content?: string;
      tool_calls?: Array<{
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }[];
}

function parseSseLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const data = trimmed.slice(5).trim();
  if (!data || data === "[DONE]") return null;
  try {
    const json = JSON.parse(data) as GptOssDelta;
    const choice = json?.choices?.[0];
    if (!choice) return null;

    // Yield content deltas
    const content = choice.delta?.content;
    if (typeof content === "string" && content) return content;

    // Yield reasoning_content as inline text (prefixed for clarity)
    // This allows clients to see the chain-of-thought in the stream.
    const reasoning = choice.delta?.reasoning_content;
    if (typeof reasoning === "string" && reasoning) return reasoning;

    // Handle tool calls
    const toolCalls = choice.delta?.tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      const formatted = toolCalls.map((tc) => ({
        name: tc.function?.name || "",
        arguments: tc.function?.arguments || "",
      }));
      return JSON.stringify({ __tool_calls: formatted });
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Determine reasoning effort header value from model id.
 * Larger models default to "medium", fast models to "low".
 */
function getReasoningEffort(modelId: string): string {
  if (modelId.includes("120b")) return "medium";
  return "low";
}

export const gptOssProvider: Provider = {
  id: "gptoss",

  async complete(req) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Reasoning-Effort": getReasoningEffort(req.model.upstream),
    };

    const payload: Record<string, unknown> = {
      model: req.model.upstream,
      messages: req.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: false,
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
    assertToolsForwarded(payload, req.tools, "gptoss", req.model.upstream);

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: req.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`GPT-OSS returned HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return { text: json?.choices?.[0]?.message?.content ?? "" };
  },

  async *stream(req) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "X-Reasoning-Effort": getReasoningEffort(req.model.upstream),
    };

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
    assertToolsForwarded(payload, req.tools, "gptoss", req.model.upstream);

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: req.signal,
    });

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => "");
      throw new Error(`GPT-OSS returned HTTP ${res.status}: ${errText.slice(0, 200)}`);
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

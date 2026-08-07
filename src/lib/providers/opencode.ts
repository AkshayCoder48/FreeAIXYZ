/**
 * OpenCode.ai provider — free, no-auth, OpenAI-compatible API.
 *
 * Endpoint: POST https://opencode.ai/zen/v1/chat/completions
 * Models:   GET  https://opencode.ai/zen/v1/models
 *
 * 61 models including flagships: Claude Opus 5, GPT-5.6, Gemini 3.6,
 * Grok 4.5, DeepSeek V4, GLM-5.2, Kimi K3, Qwen 3.6+, Minimax M3.
 *
 * Supports: real SSE streaming, native tool calling, system prompts, multi-turn.
 * No signup, no API key, no rate limits observed.
 *
 * Credit: OpenCode.ai (https://opencode.ai)
 */

import type { Provider, ProviderCompletionRequest } from "./types";

const ENDPOINT = "https://opencode.ai/zen/v1/chat/completions";
const MODELS_ENDPOINT = "https://opencode.ai/zen/v1/models";

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
    return null;
  } catch {
    return null;
  }
}

/** Fetch the live model list from OpenCode.ai. Used for auto-updating. */
export async function fetchOpenCodeModels(): Promise<
  { id: string; name?: string }[]
> {
  try {
    const res = await fetch(MODELS_ENDPOINT, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: { id: string; name?: string }[] };
    return data.data ?? [];
  } catch {
    return [];
  }
}

export const openCodeProvider: Provider = {
  id: "opencode",

  async complete(req) {
    const payload: Record<string, unknown> = {
      model: req.model.upstream,
      messages: req.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: false,
    };
    if (req.tools && req.tools.length > 0) {
      payload.tools = req.tools;
      payload.tool_choice = req.toolChoice || "auto";
    }

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: req.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`OpenCode returned HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = json?.choices?.[0]?.message?.content ?? "";
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
    if (req.tools && req.tools.length > 0) {
      payload.tools = req.tools;
      payload.tool_choice = req.toolChoice || "auto";
    }

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(payload),
      signal: req.signal,
    });

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => "");
      throw new Error(`OpenCode returned HTTP ${res.status}: ${errText.slice(0, 200)}`);
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

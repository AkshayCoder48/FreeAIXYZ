/**
 * Vexa AI provider — free, no-auth, multi-provider AI API.
 *
 * Base URL: https://vexa-ai.pages.dev
 * Chat endpoint: POST /chat (always streams via SSE)
 * Query endpoint: GET/POST /query (single-turn, JSON response)
 *
 * OpenAI-shaped SSE streaming:
 *   data: {"choices":[{"delta":{"content":"token"}}]}
 *   data: [DONE]
 *
 * 15+ text models across multiple upstream providers (DeepAI, Pollinations,
 * AIFree, TalkAI, Dolphin, Toolbaz). Default model: "vexa".
 * No API key, no account, CORS enabled.
 *
 * Credit: Vexa AI (https://vexa-ai.pages.dev)
 * Source: https://github.com/vexa-intelligence/ai
 */

import type { Provider, ProviderCompletionRequest } from "./types";

const CHAT_ENDPOINT = "https://vexa-ai.pages.dev/chat";
const QUERY_ENDPOINT = "https://vexa-ai.pages.dev/query";

interface VexaDelta {
  choices?: {
    delta?: { content?: string };
    finish_reason?: string | null;
  }[];
  error?: { message?: string };
}

function parseSseLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const data = trimmed.slice(5).trim();
  if (!data || data === "[DONE]") return null;
  try {
    const json = JSON.parse(data) as VexaDelta;

    // Check for inline stream error
    if (json.error?.message) {
      throw new Error(`Vexa AI stream error: ${json.error.message}`);
    }

    const content = json?.choices?.[0]?.delta?.content;
    return typeof content === "string" && content ? content : null;
  } catch (err) {
    // Re-throw Vexa stream errors
    if (err instanceof Error && err.message.startsWith("Vexa AI stream error:")) {
      throw err;
    }
    return null;
  }
}

export const vexaProvider: Provider = {
  id: "vexa",

  async complete(req) {
    // Use /query endpoint for non-streaming single-turn completion
    // Fall back to buffering the /chat stream for multi-turn
    const hasMultiTurn = req.messages.length > 1 ||
      req.messages.some((m) => m.role === "system");

    if (!hasMultiTurn) {
      // Single-turn: use /query (JSON response)
      const lastUserMsg = req.messages.find((m) => m.role === "user");
      const payload: Record<string, unknown> = {
        prompt: lastUserMsg?.content || "",
        model: req.model.upstream,
      };

      const res = await fetch(QUERY_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: req.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`Vexa AI returned HTTP ${res.status}: ${errText.slice(0, 200)}`);
      }

      const data = (await res.json()) as {
        success?: boolean;
        response?: string;
        error?: string;
      };
      if (!data.success || data.error) {
        throw new Error(`Vexa AI error: ${data.error || "unknown error"}`);
      }
      return { text: data.response ?? "" };
    }

    // Multi-turn: buffer the /chat stream
    let text = "";
    for await (const chunk of this.stream(req)) {
      text += chunk;
    }
    return { text };
  },

  async *stream(req) {
    const payload: Record<string, unknown> = {
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      model: req.model.upstream,
    };
    // Forward OpenAI sampling params (audit E1) — Vexa's /chat endpoint
    // speaks the OpenAI SSE protocol and accepts these fields.
    if (req.maxTokens !== undefined) payload.max_tokens = req.maxTokens;
    if (req.temperature !== undefined) payload.temperature = req.temperature;
    if (req.topP !== undefined) payload.top_p = req.topP;
    if (req.stop !== undefined) payload.stop = req.stop;
    if (req.seed !== undefined) payload.seed = req.seed;
    if (req.presencePenalty !== undefined) payload.presence_penalty = req.presencePenalty;
    if (req.frequencyPenalty !== undefined) payload.frequency_penalty = req.frequencyPenalty;
    if (req.n !== undefined) payload.n = req.n;

    const res = await fetch(CHAT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(payload),
      signal: req.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Vexa AI returned HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    if (!res.body) {
      throw new Error("Vexa AI: no response body for streaming request.");
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

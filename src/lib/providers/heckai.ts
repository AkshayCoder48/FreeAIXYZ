/**
 * HeckAI provider (api.heckai.weight-wave.com).
 *
 * Free, no-auth API with real SSE streaming. 7 models including
 * Gemini 3 Flash, DeepSeek V4, Qwen 3.7, and Minimax M3.
 *
 * Endpoint: POST https://api.heckai.weight-wave.com/api/ha/v1/chat
 *
 * The response uses a custom SSE format with markers:
 *   data: [REASON_START]  — reasoning starts (chain-of-thought, skip)
 *   data: [REASON_DONE]   — reasoning ends
 *   data: [ANSWER_START]  — answer starts (yield these)
 *   data: [ANSWER_DONE]   — answer ends
 *   data: token            — content delta
 */

import { randomUUID } from "crypto";
import type { Provider, ProviderCompletionRequest } from "./types";

const ENDPOINT = "https://api.heckai.weight-wave.com/api/ha/v1/chat";

export const heckAiProvider: Provider = {
  id: "heckai",

  async complete(req) {
    let text = "";
    for await (const chunk of this.stream(req)) {
      text += chunk;
    }
    return { text };
  },

  async *stream(req) {
    // Build the conversation context
    const lastUserMsg = [...req.messages].reverse().find((m) => m.role === "user");
    const question = lastUserMsg?.content || "Hello";

    // Include system prompt if present
    const systemMsgs = req.messages.filter((m) => m.role === "system");
    const fullQuestion = systemMsgs.length > 0
      ? `${systemMsgs.map((m) => m.content).join("\n\n")}\n\n${question}`
      : question;

    // Find previous Q&A for context
    const userMsgs = req.messages.filter((m) => m.role === "user");
    const assistantMsgs = req.messages.filter((m) => m.role === "assistant");
    const previousQuestion = userMsgs.length > 1 ? userMsgs[userMsgs.length - 2].content : null;
    const previousAnswer = assistantMsgs.length > 0 ? assistantMsgs[assistantMsgs.length - 1].content : null;

    const payload = {
      model: req.model.upstream,
      question: fullQuestion,
      language: "English",
      sessionId: randomUUID(),
      previousQuestion,
      previousAnswer,
    };

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        Origin: "https://heck.ai",
        Referer: "https://heck.ai/",
      },
      body: JSON.stringify(payload),
      signal: req.signal,
    });

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => "");
      throw new Error(`HeckAI returned HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let inAnswer = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();

          // Track state markers
          if (data === "[ANSWER_START]") {
            inAnswer = true;
            continue;
          }
          if (data === "[ANSWER_DONE]") {
            inAnswer = false;
            continue;
          }
          if (data === "[REASON_START]" || data === "[REASON_DONE]") continue;
          if (data === "[RELATE_Q_START]" || data === "[RELATE_Q_DONE]") continue;
          if (data === "[DONE]") continue;

          // Yield answer content
          if (inAnswer && data) {
            yield data;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  },
};

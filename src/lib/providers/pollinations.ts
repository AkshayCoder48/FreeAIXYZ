/**
 * Pollinations.ai provider.
 * 
 * A free, no-auth, OpenAI-compatible text generation API.
 * 
 * Endpoint: POST https://text.pollinations.ai/v1/chat/completions
 * Models:   GET  https://text.pollinations.ai/models
 * 
 * Returns standard OpenAI SSE chunks:
 *   data: {"choices":[{"delta":{"content":"token"}}]}
 *   data: [DONE]
 * 
 * The `openai-fast` model (GPT-OSS 20B) is available anonymously with real
 * token streaming and reasoning support. Rate-limited to ~1 concurrent
 * request per IP (queue), so the provider includes retry logic.
 */

import type { Provider, ProviderCompletionRequest } from "./types";
import { readSseStream, parseOpenAiSseLine, fetchWithRetry } from "./sse-utils";

const ENDPOINT = "https://text.pollinations.ai/v1/chat/completions";

interface PollinationsDelta {
  choices?: {
    delta?: { content?: string; reasoning?: string };
    finish_reason?: string | null;
  }[];
}

function parsePollinationsSseLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const data = trimmed.slice(5).trim();
  if (!data || data === "[DONE]") return null;
  try {
    const json = JSON.parse(data) as PollinationsDelta;
    // Yield content deltas only (reasoning is internal chain-of-thought)
    const delta = json.choices?.[0]?.delta?.content;
    return typeof delta === "string" ? delta : null;
  } catch {
    return null;
  }
}

export const pollinationsProvider: Provider = {
  id: "pollinations",

  async complete(req) {
    let text = "";
    for await (const chunk of this.stream(req)) {
      text += chunk;
    }
    return { text };
  },

  async *stream(req) {
    const payload = {
      model: req.model.upstream,
      messages: req.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: true,
    };

    const res = await fetchWithRetry(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: req.signal,
    });
    
    if (!res.body) {
      throw new Error("Pollinations: no response body.");
    }

    yield* readSseStream(res.body, parsePollinationsSseLine, req.signal);
  },
};

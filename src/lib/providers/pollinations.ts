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

const ENDPOINT = "https://text.pollinations.ai/v1/chat/completions";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface PollinationsDelta {
  choices?: {
    delta?: { content?: string; reasoning?: string };
    finish_reason?: string | null;
  }[];
}

function parseSseLine(line: string): string | null {
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

/** Fetch with retry on 429 (queue full). */
async function fetchWithRetry(
  payload: unknown,
  signal?: AbortSignal,
  maxRetries = 3,
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });

    if (res.status === 429) {
      if (attempt < maxRetries) {
        // Queue full — wait and retry
        await sleep(2000 * (attempt + 1));
        continue;
      }
      const errText = await res.text().catch(() => "");
      throw new Error(
        `Pollinations rate limit reached (queue full). Try again shortly or use a different model. ${errText.slice(0, 100)}`,
      );
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `Pollinations returned HTTP ${res.status}: ${errText.slice(0, 200)}`,
      );
    }

    return res;
  }
  throw new Error("Pollinations: retry attempts exhausted.");
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

    const res = await fetchWithRetry(payload, req.signal);
    if (!res.body) {
      throw new Error("Pollinations: no response body.");
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

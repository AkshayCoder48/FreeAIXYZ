/**
 * Kilo Code provider (api.kilo.ai).
 * 
 * Free, no-auth, OpenAI-compatible API with 10 free models and real SSE
 * streaming. The free tier routes through OpenRouter's free model pool.
 * 
 * Endpoint: POST https://api.kilo.ai/api/gateway/chat/completions
 * Models:   GET  https://api.kilo.ai/api/gateway/models
 * 
 * Response: standard OpenAI SSE with `: OPENROUTER PROCESSING` keep-alive
 * comments before the first token.
 */

import type { Provider, ProviderCompletionRequest } from "./types";
import { readSseStream, parseOpenAiSseLine, fetchWithRetry } from "./sse-utils";

const ENDPOINT = "https://api.kilo.ai/api/gateway/chat/completions";

export const kiloCodeProvider: Provider = {
  id: "kilocode",

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
      throw new Error("Kilo Code: no response body.");
    }

    yield* readSseStream(res.body, parseOpenAiSseLine, req.signal);
  },
};

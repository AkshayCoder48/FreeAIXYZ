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
import { readSseStream, parseOpenAiSseLine } from "./sse-utils";

const ENDPOINT = "https://api.llm7.io/v1/chat/completions";

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
    const payload = {
      model: req.model.upstream,
      messages: req.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: true,
    };

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

    yield* readSseStream(res.body, parseOpenAiSseLine, req.signal);
  },
};

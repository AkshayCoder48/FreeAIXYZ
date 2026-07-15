/**
 * TheOldLLM provider (theoldllm.vercel.app).
 *
 * A free, no-signup multi-model gateway providing access to 50+ LLMs from
 * OpenAI, Anthropic, Google, DeepSeek, xAI, Moonshot, Alibaba, Zhipu, Mistral,
 * Meta, and more — all through a single proxy endpoint.
 *
 * Endpoint: POST https://theoldllm.vercel.app/api/proxy?provider=p9
 *
 * Auth: shared tenant token (embedded in the web frontend, no signup needed).
 *
 * Request format: standard OpenAI { model, messages, stream }
 * Response format: standard OpenAI SSE (data: {"choices":[{"delta":{"content":"..."}}]})
 *
 * NOTE: This provider is marked EXPERIMENTAL because the upstream is behind a
 * Vercel Security Checkpoint that may block server-side requests with a 429.
 * The provider includes retry logic with backoff. When the checkpoint is active,
 * requests will fail with a clear error message. From browser-like environments
 * or different networks it may work.
 */

import type { Provider, ProviderCompletionRequest } from "./types";

const ENDPOINT = "https://theoldllm.vercel.app/api/proxy?provider=p9";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";

// Shared tenant token (from the public web frontend, no signup required).
const TENANT_TOKEN =
  "on_tenant_65566e34-de7f-490a-b88f-32ac8203b659.FlFtgizBOIHSKUrSYbSiT23u7VK3-AHqf64TtjN5v0qP-8AD8QJQ6RLxl0zG9Cgjj5R5ICdgNYFBz9JSv3OJcN3LiKtA6oJTj9CF_1nKjkZQ-InxkNfhEzktF52PXVvFxy7H1IR5JH9PnmMo467YfkAzf8z8vbRmW9WUQcqhBEMuxogPfqAIL1b60F8wGup7WChnADayGVAXyg0ihs4K-fXRyiR7OvXRii05DGX9XT7KtJvb24-XY_VEmWi8OO_o";

function buildHeaders() {
  return {
    Authorization: `Bearer ${TENANT_TOKEN}`,
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    "User-Agent": UA,
    "sec-ch-ua": '"Google Chrome";v="143", "Chromium";v="143", "Not_A Brand";v="24"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
    "sec-fetch-site": "same-origin",
    "sec-fetch-mode": "cors",
    "sec-fetch-dest": "empty",
    "accept-language": "en-US,en;q=0.9",
    origin: "https://theoldllm.vercel.app",
    referer: "https://theoldllm.vercel.app/",
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Parse an SSE `data:` line. Returns the content delta or null. */
function extractDelta(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const data = trimmed.slice(5).trim();
  if (!data || data === "[DONE]") return null;
  try {
    const json = JSON.parse(data);
    const delta = json?.choices?.[0]?.delta;
    // TheOldLLM may return either "content" or "reasoning_content" in delta
    if (typeof delta?.content === "string") return delta.content;
    // For reasoning models, reasoning_content is emitted separately — we
    // don't surface it as content (it's the chain-of-thought, not the answer).
    return null;
  } catch {
    return null;
  }
}

/**
 * Attempt a fetch with retry on 429 (Vercel security checkpoint).
 * Returns the response on success, throws on exhausted retries.
 */
async function fetchWithRetry(
  payload: unknown,
  signal?: AbortSignal,
  maxRetries = 2,
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(payload),
      signal,
    });

    if (res.status === 429) {
      // Vercel security checkpoint — retry with backoff
      if (attempt < maxRetries) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      // Final attempt failed — read the body to check if it's a checkpoint
      const body = await res.text().catch(() => "");
      if (/security checkpoint|vercel/i.test(body)) {
        throw new Error(
          "TheOldLLM is currently behind a Vercel security checkpoint and cannot be reached from this server. Try again later or use a different model.",
        );
      }
      throw new Error(`TheOldLLM returned HTTP 429 (rate limited). Try again later.`);
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `TheOldLLM returned HTTP ${res.status}: ${errText.slice(0, 200)}`,
      );
    }

    return res;
  }
  throw new Error("TheOldLLM: retry attempts exhausted.");
}

export const theOldLlmProvider: Provider = {
  id: "freeaionline", // reuse id space; actual provider tracked per-model

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
      throw new Error("TheOldLLM: no response body.");
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
          const delta = extractDelta(line);
          if (delta) yield delta;
        }
      }
      // flush remaining
      const delta = extractDelta(buffer);
      if (delta) yield delta;
    } finally {
      reader.releaseLock();
    }
  },
};

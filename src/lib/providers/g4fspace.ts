/**
 * G4F.space provider — OpenAI-compatible API aggregating 399+ models
 * from 45+ upstream providers (NVIDIA, OllamaSwarm, Google, CrowLLM, etc.)
 *
 * Endpoint: POST https://g4f.space/v1/chat/completions
 * Models:   GET  https://g4f.space/v1/models
 *
 * Auth: Bearer token (user-provided G4F key) — enables unlimited daily access
 * and removes the 3-active-days-per-12-days anonymous limit.
 * Response: standard OpenAI SSE format
 *
 * Retry logic: retries on 429/500/502/503 with exponential backoff (up to 2 retries).
 */

import type { Provider, ProviderCompletionRequest } from "./types";

const ENDPOINT = "https://g4f.space/v1/chat/completions";
const MAX_RETRIES = 2;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503]);

// G4F.space user API key — enables unlimited daily access
const G4F_API_KEY = "g4f_u_mqp91a_41a5cec8cb8f68804c9c2f248d1eaf44851049e488d73be9_e135930c";

function parseSseLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const data = trimmed.slice(5).trim();
  if (!data || data === "[DONE]") return null;
  try {
    const json = JSON.parse(data);
    const delta = json?.choices?.[0]?.delta?.content;
    return typeof delta === "string" ? delta : null;
  } catch {
    return null;
  }
}

/** Sleep helper for backoff. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Get backoff delay (ms) for a given retry attempt. */
function backoffDelay(attempt: number): number {
  return 1500 * (attempt + 1);
}

export const g4fSpaceProvider: Provider = {
  id: "nvidia-com",

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
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
    };

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${G4F_API_KEY}`,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
    };

    let lastError = "";

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (req.signal?.aborted) return;

      let res: Response;
      try {
        res = await fetch(ENDPOINT, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
          signal: req.signal,
        });
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (attempt < MAX_RETRIES) {
          await sleep(backoffDelay(attempt));
          continue;
        }
        throw new Error(`G4F.space network error: ${lastError}`);
      }

      if (RETRYABLE_STATUS.has(res.status)) {
        try {
          const errText = await res.text();
          lastError = `HTTP ${res.status}: ${errText.slice(0, 200)}`;
        } catch {
          lastError = `HTTP ${res.status}`;
        }
        if (attempt < MAX_RETRIES) {
          await sleep(backoffDelay(attempt));
          continue;
        }
        throw new Error(`G4F.space returned ${lastError} (after ${MAX_RETRIES + 1} attempts)`);
      }

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "");
        throw new Error(
          `G4F.space returned HTTP ${res.status}: ${errText.slice(0, 200)}`,
        );
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
      return;
    }

    if (lastError) {
      throw new Error(`G4F.space failed after ${MAX_RETRIES + 1} attempts: ${lastError}`);
    }
  },
};

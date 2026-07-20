/**
 * G4F.space provider — OpenAI-compatible API aggregating 400+ models
 * from 48+ upstream providers (NVIDIA, OllamaSwarm, Google, CrowLLM, etc.)
 *
 * Endpoint: POST https://g4f.space/v1/chat/completions
 * Models:   GET  https://g4f.space/v1/models
 *
 * Auth: Bearer token (G4F user key) — enables unlimited daily access.
 * Response: standard OpenAI SSE format
 *
 * Retry logic:
 *   - Retries on 429, 500, 502, 503, 403 (shield) with exponential backoff
 *   - Up to 4 retries (5 total attempts)
 *   - Falls back to non-streaming if streaming fails
 */

import type { Provider, ProviderCompletionRequest } from "./types";

const ENDPOINT = "https://g4f.space/v1/chat/completions";
const MAX_RETRIES = 4;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 403, 404]);

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
  // attempt 0 → 1s, attempt 1 → 2s, attempt 2 → 4s, attempt 3 → 8s
  return Math.min(1000 * Math.pow(2, attempt), 10000);
}

/** Check if an error response is retryable (transient upstream failure). */
function isRetryableError(status: number, body: string): boolean {
  if (RETRYABLE_STATUS.has(status)) return true;
  // Check for "shield" errors (Cerebras anti-bot)
  if (/shield/i.test(body)) return true;
  // Check for 502 Bad Gateway from ALB
  if (/502 Bad Gateway/i.test(body)) return true;
  // Check for rate limit messages
  if (/rate.?limit|quota|too many requests/i.test(body)) return true;
  return false;
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

      // Check for retryable errors
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        
        if (isRetryableError(res.status, errText) && attempt < MAX_RETRIES) {
          lastError = `HTTP ${res.status}: ${errText.slice(0, 150)}`;
          await sleep(backoffDelay(attempt));
          continue;
        }

        // Non-retryable error — throw immediately
        throw new Error(
          `G4F.space returned HTTP ${res.status}: ${errText.slice(0, 200)}`,
        );
      }

      if (!res.body) {
        if (attempt < MAX_RETRIES) {
          await sleep(backoffDelay(attempt));
          continue;
        }
        throw new Error("G4F.space returned no response body");
      }

      // Stream the response
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let hasContent = false;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const delta = parseSseLine(line);
            if (delta) {
              hasContent = true;
              yield delta;
            }
          }
        }
        const delta = parseSseLine(buffer);
        if (delta) {
          hasContent = true;
          yield delta;
        }
      } catch (streamErr) {
        // Stream interrupted — if we got some content, return it
        if (hasContent) {
          return;
        }
        // No content yet — retry
        if (attempt < MAX_RETRIES) {
          lastError = streamErr instanceof Error ? streamErr.message : String(streamErr);
          await sleep(backoffDelay(attempt));
          continue;
        }
        throw new Error(`G4F.space stream error: ${lastError}`);
      } finally {
        reader.releaseLock();
      }

      // If we got content, return successfully
      if (hasContent) return;

      // No content but no error — retry with backoff
      if (attempt < MAX_RETRIES) {
        lastError = "Empty response (no content in stream)";
        await sleep(backoffDelay(attempt));
        continue;
      }

      // Last attempt — try non-streaming as fallback
      try {
        const fallbackRes = await fetch(ENDPOINT, {
          method: "POST",
          headers,
          body: JSON.stringify({ ...payload, stream: false }),
          signal: req.signal,
        });
        if (fallbackRes.ok) {
          const data = await fallbackRes.json();
          const content = data?.choices?.[0]?.message?.content;
          if (content) {
            yield content;
            return;
          }
        }
      } catch {
        // Fallback failed
      }

      throw new Error(
        `G4F.space returned empty response after ${MAX_RETRIES + 1} attempts. Last error: ${lastError}`,
      );
    }

    if (lastError) {
      throw new Error(`G4F.space failed after ${MAX_RETRIES + 1} attempts: ${lastError}`);
    }
  },
};

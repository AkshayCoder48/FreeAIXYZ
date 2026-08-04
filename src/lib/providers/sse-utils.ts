/**
 * Shared SSE (Server-Sent Events) utilities for provider implementations.
 * 
 * Provides common parsers and stream handlers to reduce duplication
 * across provider adapters.
 */

/**
 * Standard OpenAI-format SSE chunk parser.
 * Expects: data: {"choices":[{"delta":{"content":"token"}}]}
 *          data: [DONE]
 */
export function parseOpenAiSseLine(line: string): string | null {
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

/**
 * Generic SSE stream reader that yields parsed deltas.
 * 
 * @param body - Response body ReadableStream
 * @param parseLine - Function to parse each SSE line, returns delta or null
 * @param signal - Optional abort signal
 */
export async function* readSseStream(
  body: ReadableStream<Uint8Array>,
  parseLine: (line: string) => string | null,
  signal?: AbortSignal,
): AsyncGenerator<string, void, unknown> {
  const reader = body.getReader();
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
        const delta = parseLine(line);
        if (delta) yield delta;
      }
    }
    // Flush any remaining content in buffer
    const delta = parseLine(buffer);
    if (delta) yield delta;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Generic fetch wrapper with retry logic for rate-limited APIs.
 * 
 * @param url - Endpoint URL
 * @param options - Fetch options
 * @param maxRetries - Maximum retry attempts (default: 2)
 * @param retryDelayMs - Base delay between retries in ms (default: 2000)
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 2,
  retryDelayMs = 2000,
): Promise<Response> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, options);

    if (res.status === 429) {
      if (attempt < maxRetries) {
        await sleep(retryDelayMs * (attempt + 1));
        continue;
      }
      const errText = await res.text().catch(() => "");
      throw new Error(`Rate limit exceeded after ${maxRetries} retries. ${errText.slice(0, 100)}`);
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`${url} returned HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    return res;
  }
  throw new Error("Retry attempts exhausted.");
}

/**
 * Helper to build a standard user-agent string.
 */
export function getDefaultUserAgent(): string {
  return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
}

/**
 * Generate a random alphanumeric string.
 * 
 * @param len - Length of the string
 */
export function randomAlphanumeric(len: number): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) {
    out += ALNUM[bytes[i] % ALNUM.length];
  }
  return out;
}

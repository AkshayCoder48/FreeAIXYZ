/**
 * DuckDuckGo AI Chat provider — free, no login, no auth.
 *
 * Endpoint: POST https://duckduckgo.com/duckchat/v1/chat
 *
 * Auth: VQD token — fetched from the DuckDuckGo search page HTML.
 * The token is embedded in the page as `vqd="4-..."`.
 * Each call fetches a fresh page → fresh token.
 *
 * Models:
 *   - gpt-4o-mini (GPT-4o Mini)
 *   - claude-3-haiku-20240307 (Claude 3 Haiku)
 *   - llama-3.1-70b-instant (Llama 3.1 70B)
 *   - mixtral-8x7b-26134 (Mixtral 8x7B)
 *
 * Response: SSE stream with `data: {"message": "..."}` events.
 *
 * Note: DuckDuckGo has anti-bot protection that may block server-side
 * requests with ERR_BN_LIMIT. The provider retries with fresh tokens.
 */

import type { Provider, ProviderCompletionRequest } from "./types";

const CHAT_URL = "https://duckduckgo.com/duckchat/v1/chat";
const PAGE_URL = "https://duckduckgo.com/?q=ai+chat&ia=chat";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

/** Fetch a fresh VQD token from the DuckDuckGo page HTML. */
async function fetchVqdToken(): Promise<string | null> {
  try {
    const res = await fetch(PAGE_URL, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    // The VQD token is in the page as: vqd="4-..."
    const match = html.match(/vqd="([0-9-]+)"/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/** Parse a DuckDuckGo SSE line. */
function parseSseLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const data = trimmed.slice(5).trim();
  if (!data || data === "[DONE]") return null;
  try {
    const json = JSON.parse(data);
    // DDG sends: {"message": "text delta"}
    const msg = json.message;
    if (typeof msg === "string") return msg;
    return null;
  } catch {
    return null;
  }
}

export const duckDuckGoProvider: Provider = {
  id: "duckduckgo",

  async complete(req) {
    let text = "";
    for await (const chunk of this.stream(req)) {
      text += chunk;
    }
    return { text };
  },

  async *stream(req) {
    const MAX_RETRIES = 2;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const vqd = await fetchVqdToken();
      if (!vqd) {
        if (attempt < MAX_RETRIES) continue;
        throw new Error("DuckDuckGo: could not fetch VQD token");
      }

      const payload = {
        model: req.model.upstream,
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
      };

      let res: Response;
      try {
        res = await fetch(CHAT_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            "x-vqd-4": vqd,
            "User-Agent": UA,
            Origin: "https://duckduckgo.com",
            Referer: "https://duckduckgo.com/?q=ai+chat",
          },
          body: JSON.stringify(payload),
          signal: req.signal,
        });
      } catch (err) {
        if (attempt < MAX_RETRIES) continue;
        throw new Error(
          `DuckDuckGo network error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      // Check for ERR_BN_LIMIT (anti-bot block)
      if (res.status === 418 || res.status === 403) {
        if (attempt < MAX_RETRIES) {
          // Wait and retry with a fresh token
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        const errText = await res.text().catch(() => "");
        throw new Error(
          `DuckDuckGo anti-bot block (${res.status}): ${errText.slice(0, 150)}. Try again later.`,
        );
      }

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "");
        throw new Error(
          `DuckDuckGo HTTP ${res.status}: ${errText.slice(0, 150)}`,
        );
      }

      // Stream the response
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
      return; // success
    }
  },
};

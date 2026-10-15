/**
 * Dopple AI provider (beta.dopple.ai) — GPT-4-class companion chat.
 *
 * Imported from the GPT-AI repo (github.com/OshekharO/GPT-AI,
 * scrapers/v15.js). Live-verified 2026-10-13:
 *
 *   POST https://beta.dopple.ai/api/messages/send
 *   body: { streamMode: "none", chatId: <32-hex>, folder: "",
 *           images: false, username: "mn0uvp2fhv",
 *           persona_name: "DoppleAI", id: "46db0561-…", userQuery }
 *   response: { status_code, response, timestamp, show_ad }
 *
 * The username/message-id are the public values hardcoded in the GPT-AI
 * scraper. The chatId is minted FRESH per request (verified: random 32-hex
 * chatIds work with the fixed username/message-id) — that avoids the shared
 * server-side history contamination of the scraper's fixed chatId while
 * still getting valid responses.
 *
 * Upstream has a single `userQuery` field (no messages array) — the adapter
 * flattens the gateway conversation into one labelled prompt. Non-streaming
 * JSON response; the upstream occasionally 500s with an internal error
 * ("Unexpected token 'I' …") — the adapter retries once.
 */

import type { Provider, ProviderCompletionRequest, ProviderMessage } from "./types";

const ENDPOINT = "https://beta.dopple.ai/api/messages/send";
/** Public username + message id hardcoded in the GPT-AI scraper (scrapers/v15.js). */
const USERNAME = "mn0uvp2fhv";
const MESSAGE_ID = "46db0561-cb3e-43d9-8f50-40b3e3c84713";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function randChatId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Flatten the gateway conversation into one labelled userQuery blob. */
function flattenForDopple(messages: ProviderMessage[]): string {
  const parts: string[] = [];
  for (const m of messages) {
    const text = (m.content ?? "").trim();
    if (!text) continue;
    if (m.role === "system") parts.push(`[System instructions] ${text}`);
    else if (m.role === "assistant") parts.push(`[Assistant said] ${text}`);
    else parts.push(`[User said] ${text}`);
  }
  return parts.length > 0 ? parts.join("\n\n") : "Hello";
}

async function doppleOnce(
  req: ProviderCompletionRequest,
): Promise<string> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": UA,
    },
    body: JSON.stringify({
      streamMode: "none",
      chatId: randChatId(), // fresh chat per request — no shared server state
      folder: "",
      images: false,
      username: USERNAME,
      persona_name: "DoppleAI",
      id: MESSAGE_ID,
      userQuery: flattenForDopple(req.messages),
    }),
    signal: AbortSignal.any([
      ...(req.signal ? [req.signal] : []),
      AbortSignal.timeout(60_000),
    ]),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Dopple AI returned HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    response?: unknown;
    status_code?: number;
  };
  if (typeof data.response !== "string" || !data.response.trim()) {
    throw new Error("Dopple AI returned no response content");
  }
  return data.response;
}

export const doppleProvider: Provider = {
  id: "dopple",

  async complete(req) {
    // One retry — the upstream intermittently 500s (internal error).
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return { text: await doppleOnce(req) };
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("Dopple AI request failed");
  },

  async *stream(req) {
    // Upstream is non-streaming (single JSON) — one honest yield.
    const result = await this.complete(req);
    yield result.text;
  },
};

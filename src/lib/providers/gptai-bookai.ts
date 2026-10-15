/**
 * BookAI provider (api.bookai.chat:2096) — GPT-3.5 Turbo book-assistant chat.
 *
 * Imported from the GPT-AI repo (github.com/OshekharO/GPT-AI, scrapers/v9.js).
 * Live-verified 2026-10-13:
 *
 *   POST https://api.bookai.chat:2096/chat
 *   body: { chatId: "test-cleancode", question, language: "English",
 *           model: "gpt-3.5-turbo", init: <bool>, messages: [{role, content}] }
 *   response: plain text (sometimes JSON-quoted)
 *
 * The `chatId` must reference an existing server-side chat ("books" are
 * created via a socket.io flow we do not replicate) — the GPT-AI scraper
 * uses the shared public chat id "test-cleancode". That chat accumulates
 * server-side history (cross-user!), so the adapter ALWAYS sends:
 *   - init: true  → resets the chat state before this request (verified:
 *     after init:true the upstream reports "FIRST" / "NONE" prior turns),
 *   - the FULL gateway conversation in `messages` (verified: the upstream
 *     answers from our messages even when server state is polluted), and
 *   - the current user turn in `question`.
 *
 * System messages inside `messages` are accepted (verified: pirate persona
 * honored). Non-streaming response → one honest stream() yield.
 */

import type { Provider, ProviderCompletionRequest, ProviderMessage } from "./types";

const ENDPOINT = "https://api.bookai.chat:2096/chat";
/** Shared public chat id hardcoded in the GPT-AI scraper (scrapers/v9.js). */
const CHAT_ID = "test-cleancode";

/** Decode the upstream reply: plain text or JSON-quoted string. */
function decodeBookaiReply(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === "string") return parsed;
    } catch {
      // Not valid JSON — treat as plain text with quote wrappers.
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

/** Split gateway messages into (question, history) for the upstream. */
function toBookaiParts(messages: ProviderMessage[]): {
  question: string;
  history: Array<{ role: string; content: string }>;
} {
  const clean = messages
    .map((m) => ({ role: m.role, content: (m.content ?? "").trim() }))
    .filter((m) => m.content.length > 0);
  if (clean.length === 0) {
    return { question: "Hello", history: [] };
  }
  // The final turn (usually the current user message) becomes `question`;
  // everything before it travels in `messages` as history.
  const last = clean[clean.length - 1];
  const history = clean.slice(0, -1);
  return { question: last.content, history };
}

export const bookaiProvider: Provider = {
  id: "bookai",

  async complete(req) {
    const { question, history } = toBookaiParts(req.messages);

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        origin: "https://www.bookai.chat",
        referer: "https://www.bookai.chat/",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      },
      body: JSON.stringify({
        chatId: CHAT_ID,
        question,
        language: "English",
        model: req.model.upstream,
        init: true, // reset the shared chat state — context comes from `messages`
        messages: history,
      }),
      signal: AbortSignal.any([
        ...(req.signal ? [req.signal] : []),
        AbortSignal.timeout(60_000),
      ]),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`BookAI returned HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    const text = decodeBookaiReply(await res.text());
    if (!text) {
      throw new Error("BookAI returned an empty reply");
    }
    return { text };
  },

  async *stream(req) {
    // Upstream is non-streaming (single text response) — one honest yield.
    const result = await this.complete(req);
    yield result.text;
  },
};

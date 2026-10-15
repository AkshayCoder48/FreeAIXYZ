/**
 * ChatWithFiction provider — "chat with Harry Potter" persona chat.
 *
 * Imported from the GPT-AI repo (github.com/OshekharO/GPT-AI,
 * scrapers/v8.js) + the site's own frontend protocol (reverse-engineered
 * from the 165-*.js chunk; the scraper's legacy `{prompt, prev}` shape also
 * still works). Live-verified 2026-10-13:
 *
 *   POST https://www.chatwithfiction.com/api/gpt
 *   body: { prompt, prevMessages: [{role, content}, …],
 *           character: "harry-potter", persona: null, forgetful: false }
 *   response: text/plain — the reply streamed as raw text chunks, wrapped in
 *             a leading+trailing double-quote (NOT valid JSON: inner quotes
 *             and newlines are not escaped — the quotes are just wrappers).
 *
 * The persona ALWAYS answers as Harry Potter; a system message sent in
 * prevMessages is ignored by the upstream (verified) — the adapter folds
 * system text into the prompt instead. Multi-turn history works via
 * prevMessages (verified: "teal" recall test).
 *
 * Streaming: real incremental plain-text chunks; wrapper quotes are stripped
 * (one leading quote at stream start, one trailing quote at stream end).
 */

import type { Provider, ProviderCompletionRequest, ProviderMessage } from "./types";

const ENDPOINT = "https://www.chatwithfiction.com/api/gpt";
const CHARACTER = "harry-potter";

interface FictionPrevMessage {
  role: "user" | "assistant";
  content: string;
}

/** Split gateway messages into (prompt, prevMessages) for the upstream. */
function toFictionPrompt(
  messages: ProviderMessage[],
): { prompt: string; prevMessages: FictionPrevMessage[] } {
  const systemTexts = messages
    .filter((m) => m.role === "system")
    .map((m) => (m.content ?? "").trim())
    .filter(Boolean);

  const convo = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
      content: (m.content ?? "").trim(),
    }))
    .filter((m) => m.content.length > 0);

  // The final user turn is the prompt; everything before it is history.
  const lastIdx = convo.map((m) => m.role).lastIndexOf("user");
  const promptTurn =
    lastIdx >= 0 ? convo[lastIdx] : convo.length > 0 ? convo[convo.length - 1] : null;
  const history =
    lastIdx >= 0
      ? convo.slice(0, lastIdx)
      : convo.slice(0, Math.max(0, convo.length - 1));

  const promptBase = promptTurn?.content ?? "Hello";
  const prompt =
    systemTexts.length > 0 ? `${systemTexts.join("\n\n")}\n\n${promptBase}` : promptBase;

  return { prompt, prevMessages: history };
}

export const chatWithFictionProvider: Provider = {
  id: "chatwithfiction",

  async complete(req) {
    let text = "";
    for await (const chunk of this.stream(req)) {
      text += chunk;
    }
    return { text };
  },

  async *stream(req: ProviderCompletionRequest) {
    const { prompt, prevMessages } = toFictionPrompt(req.messages);

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        referer: "https://www.chatwithfiction.com/chat",
        origin: "https://www.chatwithfiction.com",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      },
      body: JSON.stringify({
        prompt,
        prevMessages,
        character: CHARACTER,
        persona: null,
        forgetful: false,
      }),
      signal: AbortSignal.any([
        ...(req.signal ? [req.signal] : []),
        AbortSignal.timeout(60_000),
      ]),
    });

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => "");
      throw new Error(`ChatWithFiction returned HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    // Wrapper-quote stripping: hold back the last char of each chunk (it may
    // be the closing wrapper quote) and drop one leading quote at stream start.
    let pending = "";
    let leadHandled = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        let t = pending + decoder.decode(value, { stream: true });
        pending = "";
        if (!leadHandled) {
          leadHandled = true;
          if (t.startsWith('"')) {
            t = t.slice(1);
            if (!t) continue;
          }
        }
        if (t.length > 0) {
          pending = t.slice(-1);
          const out = t.slice(0, -1);
          if (out) yield out;
        }
      }
      // Flush final flush of decoder + held char. A trailing '"' is the
      // wrapper quote — drop it; anything else is real content.
      let tail = pending + decoder.decode();
      pending = "";
      if (tail.startsWith('"') && tail.endsWith('"') && tail.length >= 2) {
        tail = tail.slice(1, -1);
      } else if (tail.endsWith('"')) {
        tail = tail.slice(0, -1);
      }
      if (tail) yield tail;
    } finally {
      reader.releaseLock();
    }
  },
};

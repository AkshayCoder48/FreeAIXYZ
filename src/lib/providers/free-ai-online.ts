/**
 * Free-AI-Online.com provider (experimental).
 *
 * Endpoint: POST https://www.free-ai-online.com/wp-json/mwai-ui/v1/chats/submit
 *
 * This is a WordPress MWAI plugin. It requires an `X-WP-Nonce` header which we
 * fetch fresh from the homepage on each request (rotated). The response is an
 * SSE stream of `data: {"type":"live","data":" token"}` lines ending with
 * `data: {"type":"end",...}`.
 *
 * NOTE: This endpoint is sometimes behind a captcha / bot-protection layer and
 * may return 503 from some network environments. It is marked experimental.
 */

import { randomBytes } from "crypto";
import type { Provider, ProviderCompletionRequest } from "./types";

const HOME = "https://www.free-ai-online.com/";
const ENDPOINT =
  "https://www.free-ai-online.com/wp-json/mwai-ui/v1/chats/submit";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const HEX = "0123456789abcdef";
function randHex(len: number): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += HEX[bytes[i] % 16];
  return out;
}

/** Fetch a fresh nonce + cookies from the homepage. */
async function fetchNonceAndCookies(): Promise<{
  nonce: string;
  cookies: string;
}> {
  const res = await fetch(HOME, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  const html = await res.text();

  // Parse Set-Cookie into a Cookie header
  const setCookies = res.headers.getSetCookie?.() ?? [];
  const cookies = setCookies.map((c) => c.split(";")[0]).join("; ");

  // Extract nonce: "nonce":"abcdef1234"
  const m = html.match(/"nonce"\s*:\s*"([a-f0-9]+)"/);
  return { nonce: m?.[1] ?? "", cookies };
}

/** Parse an SSE line. Returns { type, data }. */
function parseSseLine(line: string): { type: string; data: string } | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const raw = trimmed.slice(5).trim();
  if (!raw) return null;
  try {
    const json = JSON.parse(raw);
    if (typeof json.type === "string") {
      return { type: json.type, data: typeof json.data === "string" ? json.data : "" };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export const freeAiOnlineProvider: Provider = {
  id: "toolbaz", // unused legacy file

  async complete(req) {
    let text = "";
    for await (const chunk of this.stream(req)) {
      text += chunk;
    }
    return { text };
  },

  async *stream(req) {
    const { nonce, cookies } = await fetchNonceAndCookies();
    if (!nonce) {
      throw new Error(
        "Free-AI-Online: could not fetch a valid nonce (site may be captcha-gated from this network).",
      );
    }

    // Build the MWAI payload. The last user message is `newMessage`; prior
    // messages become the `messages` context array.
    const convo = req.messages.filter(
      (m) => m.role === "user" || m.role === "assistant",
    );
    const last = convo[convo.length - 1];
    const history = convo.slice(0, -1).map((m, i) => ({
      id: randHex(12),
      role: m.role,
      content: m.content,
      who: m.role === "assistant" ? "AI: " : "User: ",
      timestamp: Date.now() + i,
      key: `start-${Date.now() + i}`,
    }));

    const payload = {
      botId: req.model.upstream,
      customId: null,
      session: randHex(13),
      chatId: randHex(11),
      contextId: 25,
      messages: history,
      newMessage: last?.content ?? "",
      newFileId: null,
      newFileIds: null,
      stream: true,
    };

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "X-WP-Nonce": nonce,
        "User-Agent": UA,
        Origin: HOME.replace(/\/$/, ""),
        Referer: HOME,
        ...(cookies ? { Cookie: cookies } : {}),
      },
      body: JSON.stringify(payload),
      signal: req.signal,
    });

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => "");
      // 503 with HTML = captcha challenge
      if (res.status === 503 || /captcha|challenge|cloudflare/i.test(errText)) {
        throw new Error(
          "Free-AI-Online is currently behind a captcha challenge from this network. Try again later or use a different model.",
        );
      }
      throw new Error(
        `Free-AI-Online returned HTTP ${res.status}: ${errText.slice(0, 200)}`,
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
          const evt = parseSseLine(line);
          if (!evt) continue;
          if (evt.type === "live") {
            yield evt.data;
          } else if (evt.type === "end") {
            // The "end" event's data is a JSON string with a "reply" field —
            // yield it too in case the live tokens missed anything.
            try {
              const endJson = JSON.parse(evt.data);
              if (endJson.reply) yield endJson.reply;
            } catch {
              /* ignore */
            }
            return;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  },
};

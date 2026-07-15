/**
 * UnlimitedAI.chat provider (app.unlimitedai.chat).
 *
 * Endpoint: POST https://app.unlimitedai.chat/api/chat
 *
 * Free, no-auth, uncensored chat with NDJSON streaming. Accepts any
 * `selectedChatModel` value; the two real models are `chat-model-reasoning`
 * and `chat-model-reasoning-with-search`.
 *
 * Response is application/x-ndjson — one JSON object per line:
 *   {"type":"delta","delta":"token"}
 *   {"type":"error","error":"..."}   (on failure)
 *
 * No [DONE] marker — stream ends when the connection closes.
 */

import { randomUUID } from "crypto";
import type { Provider, ProviderCompletionRequest } from "./types";

const ENDPOINT = "https://app.unlimitedai.chat/api/chat";

interface UnlimitedEvent {
  type: string;
  delta?: string;
  error?: string;
}

function parseNdjsonLine(line: string): UnlimitedEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as UnlimitedEvent;
  } catch {
    return null;
  }
}

export const unlimitedAiProvider: Provider = {
  id: "nsfwlover",

  async complete(req) {
    let text = "";
    for await (const chunk of this.stream(req)) {
      text += chunk;
    }
    return { text };
  },

  async *stream(req) {
    // Build the messages array in the format unlimitedai expects.
    const messages = req.messages.map((m) => ({
      id: randomUUID(),
      role: m.role,
      content: m.content,
      parts: [{ type: "text", text: m.content }],
      createdAt: new Date().toISOString(),
    }));

    const payload = {
      chatId: randomUUID(),
      messages,
      selectedChatModel: req.model.upstream,
      selectedCharacter: null,
      selectedStory: null,
      deviceId: randomUUID(),
      locale: "en",
    };

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-next-intl-locale": "en",
        Origin: "https://app.unlimitedai.chat",
        Referer: "https://app.unlimitedai.chat/",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      },
      body: JSON.stringify(payload),
      signal: req.signal,
    });

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `UnlimitedAI returned HTTP ${res.status}: ${errText.slice(0, 200)}`,
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
        // NDJSON: each line is a complete JSON object
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const evt = parseNdjsonLine(line);
          if (!evt) continue;
          if (evt.type === "delta" && typeof evt.delta === "string") {
            yield evt.delta;
          } else if (evt.type === "error" && evt.error) {
            throw new Error(`UnlimitedAI error: ${evt.error}`);
          }
        }
      }
      // flush remaining
      const evt = parseNdjsonLine(buffer);
      if (evt?.type === "delta" && typeof evt.delta === "string") {
        yield evt.delta;
      }
    } finally {
      reader.releaseLock();
    }
  },
};

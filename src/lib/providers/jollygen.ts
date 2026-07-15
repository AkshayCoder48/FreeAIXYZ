/**
 * JollyGen provider (jollygenapi.space).
 *
 * Endpoint: POST https://jollygenapi.space/ai/chat-guest
 *
 * Free, no-signup NSFW roleplay AI. Each guest_hash gets 3 free messages,
 * so we rotate a fresh random hash per request for unlimited access.
 *
 * SSE format:
 *   : stream-open
 *   data: {"delta": "token"}       // ← content tokens
 *   data: {"done": true, ...}      // ← end marker
 */

import { randomBytes, createHash } from "crypto";
import type { Provider, ProviderCompletionRequest } from "./types";

const ENDPOINT = "https://jollygenapi.space/ai/chat-guest";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

/** Generate a fresh 64-char hex guest hash (rotated per request). */
function freshGuestHash(): string {
  return createHash("sha256")
    .update(randomBytes(32).toString("hex") + Date.now() + Math.random())
    .digest("hex");
}

interface JollyEvent {
  delta?: string;
  done?: boolean;
  detail?: { message?: string };
}

function parseEvent(line: string): JollyEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const raw = trimmed.slice(5).trim();
  if (!raw || raw === "[DONE]") return null;
  try {
    return JSON.parse(raw) as JollyEvent;
  } catch {
    return null;
  }
}

export const jollyGenProvider: Provider = {
  id: "nsfwlover",

  async complete(req) {
    let text = "";
    for await (const chunk of this.stream(req)) {
      text += chunk;
    }
    return { text };
  },

  async *stream(req) {
    // Build the message: JollyGen takes a single `message` string. We join
    // the conversation into a roleplay-friendly format.
    const sys = req.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n");
    const convo = req.messages.filter(
      (m) => m.role === "user" || m.role === "assistant",
    );
    // Fold history into the message for context.
    let message: string;
    if (convo.length === 1) {
      message = convo[0].content;
    } else {
      const parts = convo.map((m) =>
        m.role === "user" ? `[User]: ${m.content}` : `[Assistant]: ${m.content}`,
      );
      message = parts.join("\n");
    }
    if (sys) {
      message = `${sys}\n\n${message}`;
    }

    const payload = {
      message,
      stream: true,
      guest_hash: freshGuestHash(),
    };

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://chat.jollyai.online",
        Referer: "https://chat.jollyai.online/",
        "User-Agent": UA,
      },
      body: JSON.stringify(payload),
      signal: req.signal,
    });

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => "");
      // 429 = quota hit on this hash (shouldn't happen with rotation, but handle it)
      if (res.status === 429) {
        throw new Error(
          "JollyGen rate-limited. Retrying will use a fresh identity.",
        );
      }
      throw new Error(
        `JollyGen returned HTTP ${res.status}: ${errText.slice(0, 200)}`,
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
          const evt = parseEvent(line);
          if (!evt) continue;
          if (typeof evt.delta === "string") {
            yield evt.delta;
          }
          if (evt.done) return;
          if (evt.detail?.message) {
            throw new Error(`JollyGen: ${evt.detail.message}`);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  },
};

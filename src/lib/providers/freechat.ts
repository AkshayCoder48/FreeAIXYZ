/**
 * FreeChat provider — free, no-auth chat via llmproxy.org.
 *
 * Endpoint: POST https://llmproxy.org/api/chat.php
 * Origin/Referer: https://freechat.org
 *
 * 1 model (v3). Returns JSON { content, credits } or SSE stream.
 * Credits regenerate (29 free credits observed, decrements per request).
 *
 * Credit: FreeChat.org / llmproxy.org
 */

import type { Provider, ProviderCompletionRequest } from "./types";

const ENDPOINT = "https://llmproxy.org/api/chat.php";

export const freeChatProvider: Provider = {
  id: "freechat",

  async complete(req) {
    const payload = {
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      model: "v3",
      stream: false,
    };

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://freechat.org",
        Referer: "https://freechat.org",
      },
      body: JSON.stringify(payload),
      signal: req.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`FreeChat returned HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = (await res.json()) as { content?: string };
    return { text: data.content ?? "" };
  },

  async *stream(req) {
    const payload = {
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      model: "v3",
      stream: true,
    };

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Origin: "https://freechat.org",
        Referer: "https://freechat.org",
      },
      body: JSON.stringify(payload),
      signal: req.signal,
    });

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => "");
      throw new Error(`FreeChat returned HTTP ${res.status}: ${errText.slice(0, 200)}`);
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
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const json = JSON.parse(data);
            const delta = json?.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta) yield delta;
          } catch {
            /* skip non-JSON lines (keep-alive comments, credit info) */
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  },
};

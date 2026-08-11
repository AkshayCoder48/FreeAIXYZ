/**
 * SurfSense provider (api.surfsense.com).
 *
 * Endpoint: POST https://api.surfsense.com/api/v1/public/anon-chat/stream
 *
 * Free, no-auth, anonymous chat with real SSE streaming. Supports two model
 * slugs: `gpt-5.4-mini-no-login` and `gpt-o4-mini-no-login`.
 *
 * The SSE format is custom (NOT OpenAI-shaped):
 *   data: {"type": "start", "messageId": "..."}
 *   data: {"type": "start-step"}
 *   data: {"type": "data-thinking-step", "data": {...}}   // thinking UI
 *   data: {"type": "text-start", "id": "..."}
 *   data: {"type": "text-delta", "id": "...", "delta": "token"}   // ← content
 *   data: {"type": "text-end", "id": "..."}
 *   data: {"type": "data-anon-quota", "data": {...}}
 *   data: {"type": "finish-step"}
 *   data: {"type": "finish"}
 *   data: [DONE]
 *
 * We extract `text-delta` events and yield their `delta` field as content.
 */

import type { Provider, ProviderCompletionRequest } from "./types";

const ENDPOINT = "https://api.surfsense.com/api/v1/public/anon-chat/stream";

interface SurfSenseEvent {
  type: string;
  delta?: string;
  errorText?: string;
  data?: unknown;
}

function parseEvent(line: string): SurfSenseEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const raw = trimmed.slice(5).trim();
  if (!raw || raw === "[DONE]") return null;
  try {
    return JSON.parse(raw) as SurfSenseEvent;
  } catch {
    return null;
  }
}

export const surfSenseProvider: Provider = {
  id: "surfsense",

  async complete(req) {
    let text = "";
    for await (const chunk of this.stream(req)) {
      text += chunk;
    }
    return { text };
  },

  async *stream(req) {
    const payload = {
      model_slug: req.model.upstream,
      messages: req.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    };

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: req.signal,
    });

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `SurfSense returned HTTP ${res.status}: ${errText.slice(0, 200)}`,
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
          if (evt.type === "text-delta" && typeof evt.delta === "string") {
            yield evt.delta;
          } else if (evt.type === "error" && evt.errorText) {
            throw new Error(`SurfSense error: ${evt.errorText}`);
          }
        }
      }
      // flush
      const evt = parseEvent(buffer);
      if (evt?.type === "text-delta" && typeof evt.delta === "string") {
        yield evt.delta;
      }
    } finally {
      reader.releaseLock();
    }
  },
};

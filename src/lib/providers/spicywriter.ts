/**
 * SpicyWriter provider — free anonymous NSFW/uncensored chat API.
 *
 * Endpoint: POST https://spicywriter.com/api/conversations/new
 *
 * Auth: NONE — uses a freshly-generated anonymous user id per request
 * (X-Anonymous-User-Id header). Each anon id gets 5 free requests, so we
 * rotate a new id on every single call → effectively unlimited.
 *
 * Models:
 *   - "Ling 2.6 Flash" — fast general model
 *   - "Nemo" — uncensored NSFW model
 *
 * Response format: SSE stream
 *   data: {"conversationId":1,"idMappings":"..."}    — metadata
 *   data: {"type":"context_start",...}                — start marker
 *   data:  text delta                                 — content chunks (plain text)
 *   data: {"done":true}                               — end marker
 *
 * Multi-turn: messages are linked via `parent` field (message id chain).
 * Tool calling: supported via prompt injection (NSFW-uncensored system preamble).
 */

import type { Provider, ProviderCompletionRequest } from "./types";

const ENDPOINT = "https://spicywriter.com/api/conversations/new";

/** Generate a random anonymous user id: anon_XXXXXX (6 hex chars). */
function makeAnonId(): string {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `anon_${hex}`;
}

/** Generate a W3C traceparent header value. */
function makeTraceparent(): string {
  const traceBytes = new Uint8Array(16);
  const spanBytes = new Uint8Array(8);
  crypto.getRandomValues(traceBytes);
  crypto.getRandomValues(spanBytes);
  const traceId = Array.from(traceBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const spanId = Array.from(spanBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `00-${traceId}-${spanId}-01`;
}

/** The X-Client-Diag header value (always unauthenticated). */
const CLIENT_DIAG = JSON.stringify({
  csrf: false,
  uid: null,
  lastUid: null,
  authed: false,
  sinceCsrfMs: null,
  persisted: false,
  resumeMs: null,
  pwa: false,
  online: true,
});

interface SpicyMessage {
  id: number;
  content: string;
  role: "system" | "user" | "assistant";
  parent: number | null;
  writer: string;
}

/**
 * Convert OpenAI-style messages into SpicyWriter's `messagesToCreate` format.
 * Messages are chained via `parent` (each message's parent is the previous
 * message's id). System messages have parent null.
 */
function buildSpicyMessages(
  messages: ProviderCompletionRequest["messages"],
): { messagesToCreate: SpicyMessage[]; submitMessageId: number } {
  const out: SpicyMessage[] = [];
  let nextId = 0;
  let lastId: number | null = null;

  // SpicyWriter uses negative ids for "new" messages, starting at 0 for system.
  // We'll use: 0 = system, -1 = first user, -2 = first assistant, -3 = second user, etc.
  // The parent chain: system(0, parent null) → user(-1, parent 0) → assistant(-2, parent -1) → ...

  // If there's no system message, we still need id 0 as a root.
  let hasSystem = false;
  for (const m of messages) {
    if (m.role === "system") {
      hasSystem = true;
      out.push({
        id: 0,
        content: m.content,
        role: "system",
        parent: null,
        writer: "spicy",
      });
      lastId = 0;
      break;
    }
  }

  if (!hasSystem) {
    // Root system message with empty content
    out.push({
      id: 0,
      content: "",
      role: "system",
      parent: null,
      writer: "spicy",
    });
    lastId = 0;
  }

  // Now add user/assistant messages with negative ids
  let negId = -1;
  for (const m of messages) {
    if (m.role === "system") continue;
    out.push({
      id: negId,
      content: m.content,
      role: m.role === "assistant" ? "assistant" : "user",
      parent: lastId,
      writer: "spicy",
    });
    lastId = negId;
    negId--;
  }

  // The last message is the one to submit (get response for)
  const submitMessageId = lastId;

  return { messagesToCreate: out, submitMessageId };
}

/** Parse an SSE line and return text delta or null. */
function parseSseDelta(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const data = trimmed.slice(5).trim();
  if (!data) return null;

  // Check for JSON control events
  if (data.startsWith("{")) {
    try {
      const json = JSON.parse(data);
      // {"done":true} — end marker
      if (json.done === true) return null;
      // {"conversationId":...} — metadata, skip
      if (json.conversationId !== undefined) return null;
      // {"type":"context_start",...} — start marker, skip
      if (json.type !== undefined) return null;
      // Any other JSON — skip
      return null;
    } catch {
      return null;
    }
  }

  // Plain text delta — this is the content
  return data;
}

export const spicyWriterProvider: Provider = {
  id: "spicywriter",

  async complete(req) {
    let text = "";
    for await (const chunk of this.stream(req)) {
      text += chunk;
    }
    return { text };
  },

  async *stream(req) {
    const { messagesToCreate, submitMessageId } = buildSpicyMessages(
      req.messages,
    );

    const payload = {
      messagesToCreate,
      messagesToEdit: [],
      submitMessageId,
      model: req.model.upstream,
      writer: "spicy",
      thinking: false,
      responseId: submitMessageId - 1,
      title: `Chat ${new Date().toLocaleString()}`,
    };

    const anonId = makeAnonId();

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Anonymous-User-Id": anonId,
        "X-Client-Diag": CLIENT_DIAG,
        traceparent: makeTraceparent(),
        Accept: "text/event-stream",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
      },
      body: JSON.stringify(payload),
      signal: req.signal,
    });

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `SpicyWriter returned HTTP ${res.status}: ${errText.slice(0, 200)}`,
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
          const delta = parseSseDelta(line);
          if (delta !== null) yield delta;
        }
      }
      // Flush remaining
      const delta = parseSseDelta(buffer);
      if (delta !== null) yield delta;
    } finally {
      reader.releaseLock();
    }
  },
};

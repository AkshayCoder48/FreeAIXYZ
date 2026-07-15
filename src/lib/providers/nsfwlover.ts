/**
 * NSFWLover.com provider.
 *
 * Endpoint: POST https://www.nsfwlover.com/api/openai/chat/completions
 *
 * This is a genuinely OpenAI-compatible SSE endpoint that streams
 * `delta.content` token-by-token. Auth is a per-request random `x-local-id`
 * header (no signup). The only accepted `model_type` is `llama3-8b` which maps
 * upstream to `sao10k/l3-lunaris-8b` — an uncensored LLaMA-3 8B roleplay model.
 *
 * Every request rotates a fresh `x-local-id` and `session_id`, so identities
 * never accumulate state.
 */

import { randomBytes, randomUUID } from "crypto";
import type { Provider, ProviderCompletionRequest } from "./types";

const ENDPOINT = "https://www.nsfwlover.com/api/openai/chat/completions";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const ALNUM =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function randStr(len: number): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += ALNUM[bytes[i] % ALNUM.length];
  return out;
}

/** Build the NSFWLover payload from OpenAI-style messages. */
function buildPayload(
  modelType: string,
  messages: ProviderCompletionRequest["messages"],
) {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const dateStr = `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  // NSFWLover expects a flat list of input_messages with explicit roles.
  // We collapse system messages into the sysprompt field.
  const sysprompt = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const convo = messages.filter(
    (m) => m.role === "user" || m.role === "assistant",
  );

  const inputMessages = convo.map((m, i) => ({
    id: i === convo.length - 1 ? randStr(20) : randomUUID(),
    type: "text",
    date: dateStr,
    role: m.role,
    content: m.content,
  }));

  return {
    builtin: true,
    char: null,
    // char_id and charname MUST match — the backend rejects mismatches with
    // an opaque "OpenAI unavailable" 500. We use a neutral SFW character id
    // so the model behaves as a general assistant rather than a fixed persona.
    char_id: "Linda",
    session_id: randStr(22),
    lang: "en",
    sysprompt,
    description: "",
    input_messages: inputMessages,
    stream: true,
    model_type: modelType,
    isSummary: false,
    charname: "Linda",
    shortname: "",
    username: "Guest",
    session_date: dateStr,
    gender: "Unknown",
    userGender: "Unknown",
  };
}

function headers() {
  return {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    "x-local-id": randStr(60),
    Origin: "https://www.nsfwlover.com",
    Referer: "https://www.nsfwlover.com/",
    "User-Agent": UA,
  };
}

/**
 * Parse one SSE `data:` line. Returns the content delta or null.
 * NSFWLover emits OpenAI-shaped chunks:
 *   data: {"choices":[{"delta":{"content":"token"}}]}
 * The stream ends with a chunk whose choices[0].finish_reason is set, then
 * the connection closes (no explicit [DONE]).
 */
function extractDelta(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const data = trimmed.slice(5).trim();
  if (!data || data === "[DONE]") return null;
  try {
    const json = JSON.parse(data);
    const delta = json?.choices?.[0]?.delta?.content;
    return typeof delta === "string" ? delta : null;
  } catch {
    return null;
  }
}

export const nsfwloverProvider: Provider = {
  id: "nsfwlover",

  async complete(req) {
    // Buffer the full stream.
    let text = "";
    for await (const chunk of this.stream(req)) {
      text += chunk;
    }
    return { text };
  },

  async *stream(req) {
    const payload = buildPayload(req.model.upstream, req.messages);
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(payload),
      signal: req.signal,
    });

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `NSFWLover returned HTTP ${res.status}: ${errText.slice(0, 200)}`,
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
          const delta = extractDelta(line);
          if (delta) yield delta;
        }
      }
      // flush any remaining
      const delta = extractDelta(buffer);
      if (delta) yield delta;
    } finally {
      reader.releaseLock();
    }
  },
};

/**
 * Free2GPT (chat4) provider — free, no-auth, signed-request API.
 *
 * Endpoint: POST https://chat4.free2gpt.com/api/generate
 *
 * Live-verified (Task 7 discovery): custom contract, no API key, no
 * signup, no cookies. Auth is a SHA-256 signature over the request body
 * with an EMPTY secret (the signature IS the auth).
 *
 *   sign = sha256(f"{time_ms}:{last_user_message_content}:")
 *
 * (trailing colon — the secret slot is empty). Verified byte-for-byte
 * against the live site's own JS bundle.
 *
 * Request body (sent as `Content-Type: text/plain;charset=UTF-8` — unusual
 * but that's what the site sends): a JSON string of
 *   { "messages":[{role,content},...], "time":<ms>, "pass":null, "sign":"<hex>" }
 *
 * Response: HTTP 200 plain text (NOT JSON, NOT SSE). The adapter wraps the
 * whole text as a single OpenAI `delta.content` chunk — the gateway's
 * streaming-proxy emits it honestly as one content chunk + stop (PRD §137:
 * never fake-stream a non-streaming upstream).
 *
 * Model: server picks (no `model` field in the request). Exposed as
 * `f2/free2gpt-auto` so clients see a stable canonical id.
 *
 * Credit: Free2GPT (https://chat4.free2gpt.com)
 * Discovered via: https://github.com/zebbern/no-cost-ai (no-signup list)
 */

import type { Provider, ProviderCompletionRequest } from "./types";

const ENDPOINT = "https://chat4.free2gpt.com/api/generate";

/** Web-Crypto SHA-256 (Edge + Node compatible — matches toolbaz.ts style). */
async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Build the signed request body for chat4.free2gpt.com.
 *
 * The signature is computed over the string `<time_ms>:<lastMsg>:` with
 * an empty trailing secret. The site's own client JS uses the exact same
 * algorithm — verified byte-for-byte against a captured request.
 */
async function buildSignedBody(
  messages: { role: string; content: string }[],
): Promise<string> {
  // Find the last user message content (the signing input).
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const lastContent = lastUser?.content ?? "";
  const time = Date.now();
  // sign = sha256(f"{time}:{lastContent}:")  — empty secret slot.
  const signInput = `${time}:${lastContent}:`;
  const sign = await sha256Hex(signInput);
  const body = {
    messages,
    time,
    pass: null,
    sign,
  };
  return JSON.stringify(body);
}

export const free2GptProvider: Provider = {
  id: "free2gpt",

  async complete(req) {
    // Single-shot endpoint — buffer the (single-chunk) stream.
    let text = "";
    for await (const chunk of this.stream(req)) {
      text += chunk;
    }
    return { text };
  },

  async *stream(req) {
    const messages = req.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const signedBody = await buildSignedBody(messages);

    // Content-Type is text/plain per the site's own client (unusual for a
    // JSON body, but the upstream expects exactly this — verified live).
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=UTF-8",
        Accept: "*/*",
        Origin: "https://chat4.free2gpt.com",
        Referer: "https://chat4.free2gpt.com/",
      },
      body: signedBody,
      signal: req.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `Free2GPT returned HTTP ${res.status}: ${errText.slice(0, 200)}`,
      );
    }

    // Response is plain text (not JSON, not SSE). Read the full body and
    // yield once — the gateway's streaming-proxy wraps this single chunk
    // honestly as one content delta + finish_reason:stop (PRD §137: never
    // fake-stream a non-streaming upstream).
    const text = await res.text();
    if (text && text.trim()) {
      yield text;
    }
  },
};

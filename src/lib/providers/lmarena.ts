/**
 * LMArena (arena.ai) provider.
 *
 * Uses the user-provided auth token (stored in browser localStorage via the
 * /settings page, passed in the `x-lmarena-token` request header).
 *
 * Flow:
 *   1. POST https://arena.ai/nextjs-api/stream/create-evaluation
 *      with model ID, message, and UUIDv7 session IDs
 *   2. Response streams with prefixed lines:
 *      a0:{"text":"..."}  — content delta
 *      ag:"..."           — reasoning delta
 *
 * The token is passed from the client as `x-lmarena-token` header.
 * If no token is provided, the provider returns a clear error.
 */

import { randomBytes } from "crypto";
import type { Provider, ProviderCompletionRequest } from "./types";

const CREATE_EVALUATION = "https://arena.ai/nextjs-api/stream/create-evaluation";

/** Generate a UUIDv7 (timestamp-based, matching LMArena's browser implementation). */
function uuid7(): string {
  const timestampMs = Date.now();
  const randA = randomBytes(2).readUInt16BE(0) & 0x0fff;
  const randB = randomBytes(8);
  // Set version (7) and variant (10xx)
  randB[0] = (randB[0] & 0x3f) | 0x80; // variant
  const ts = BigInt(timestampMs) << 80n;
  const ra = BigInt(0x7000 | randA) << 64n;
  const rb = BigInt(
    "0x" +
      Array.from(randB)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(""),
  );
  const uuidInt = ts | ra | rb;
  const hex = uuidInt.toString(16).padStart(32, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Parse an LMArena SSE line. Returns content delta or null. */
function parseLmaLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  // a0:{"text":"..."} — content
  if (trimmed.startsWith("a0:")) {
    try {
      const data = JSON.parse(trimmed.slice(3));
      if (typeof data === "string") return data;
      if (data?.text) return data.text;
      if (typeof data === "object" && data !== null) return null; // metadata
      return null;
    } catch {
      return null;
    }
  }
  // ag:"..." — reasoning (skip, not content)
  // b0: — model B content (skip in direct mode)
  return null;
}

export const lmarenaProvider: Provider = {
  id: "g4f", // reuse id space; actual provider tracked per-model

  async complete(req) {
    let text = "";
    for await (const chunk of this.stream(req)) {
      text += chunk;
    }
    return { text };
  },

  async *stream(req) {
    // The auth token is passed via the request's extra params
    // (set by the route handler from the x-lmarena-token header)
    const token = (req as ProviderCompletionRequest & { authToken?: string }).authToken;
    if (!token) {
      throw new Error(
        "LMArena requires an auth token. Go to /settings and paste your arena.ai session token.",
      );
    }

    // Build the evaluation request
    const evaluationSessionId = uuid7();
    const userMessageId = uuid7();
    const modelAMessageId = uuid7();

    // Get the last user message as the prompt
    const lastUserMsg = [...req.messages].reverse().find((m) => m.role === "user");
    const prompt = lastUserMsg?.content || "Hello";

    // System prompt prepended if present
    const systemMsgs = req.messages.filter((m) => m.role === "system");
    const fullPrompt = systemMsgs.length > 0
      ? `${systemMsgs.map((m) => m.content).join("\n\n")}\n\n${prompt}`
      : prompt;

    const data = {
      id: evaluationSessionId,
      mode: "direct-battle",
      userMessageId,
      modelAMessageId,
      userMessage: {
        content: fullPrompt,
        experimental_attachments: [],
        metadata: {},
      },
      modality: "chat",
      recaptchaV3Token: "",
      modelAId: req.model.upstream,
    };

    const res = await fetch(CREATE_EVALUATION, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        Cookie: `__Secure-next-auth.session-token=${token}`,
        Origin: "https://arena.ai",
        Referer: "https://arena.ai/",
      },
      body: JSON.stringify(data),
      signal: req.signal,
    });

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => "");
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          "LMArena token is invalid or expired. Go to /settings to update it.",
        );
      }
      throw new Error(`LMArena returned HTTP ${res.status}: ${errText.slice(0, 200)}`);
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
          const delta = parseLmaLine(line);
          if (delta) yield delta;
        }
      }
      const delta = parseLmaLine(buffer);
      if (delta) yield delta;
    } finally {
      reader.releaseLock();
    }
  },
};

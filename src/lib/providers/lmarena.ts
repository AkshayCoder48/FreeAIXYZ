/**
 * LMArena (arena.ai) provider.
 *
 * Uses the user-provided auth token (stored in browser localStorage via the
 * /settings page, passed in the `x-lmarena-token` request header).
 *
 * The token is a base64-encoded Supabase session JSON containing:
 *   { access_token, refresh_token, expires_at, user, ... }
 *
 * We decode it and use the access_token as a Bearer header AND set the
 * Supabase session cookie for arena.ai's Next.js API.
 *
 * Flow:
 *   1. POST https://arena.ai/nextjs-api/stream/create-evaluation
 *      with model publicName, message, and UUIDv7 session IDs
 *   2. Response streams with prefixed lines:
 *      a0:{"text":"..."}  — content delta
 *
 * Arena.ai has 413+ text models (GPT-5.x, Claude Opus 4.8, Gemini 3.1 Pro,
 * Grok 4.3, DeepSeek V4, Qwen 3.7, Kimi K2.7, GLM 5.1, etc.)
 */

import { randomBytes } from "crypto";
import type { Provider, ProviderCompletionRequest } from "./types";

const CREATE_EVALUATION = "https://arena.ai/nextjs-api/stream/create-evaluation";
const SB_PROJECT_ID = "huogzoeqzcrdvkwtvodi";

/** Generate a UUIDv7 (timestamp-based, matching LMArena's browser implementation). */
function uuid7(): string {
  const timestampMs = Date.now();
  const randA = randomBytes(2).readUInt16BE(0) & 0x0fff;
  const randB = randomBytes(8);
  randB[0] = (randB[0] & 0x3f) | 0x80;
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
      return null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Decode the base64 session token and extract the access_token. */
function decodeSessionToken(token: string): { accessToken: string; cookie: string } | null {
  try {
    // The token is a base64-encoded Supabase session JSON
    const decoded = Buffer.from(token, "base64").toString("utf8");
    const session = JSON.parse(decoded);
    if (!session.access_token) return null;
    // Build the Supabase auth cookie: sb-<project>-auth-token=<base64_session>
    const cookie = `sb-${SB_PROJECT_ID}-auth-token=${token}`;
    return { accessToken: session.access_token, cookie };
  } catch {
    // If it's not base64 JSON, treat it as a raw access_token
    return { accessToken: token, cookie: `sb-${SB_PROJECT_ID}-auth-token=${token}` };
  }
}

export const lmarenaProvider: Provider = {
  id: "lmarena",

  async complete(req) {
    let text = "";
    for await (const chunk of this.stream(req)) {
      text += chunk;
    }
    return { text };
  },

  async *stream(req) {
    const rawToken = (req as ProviderCompletionRequest & { authToken?: string }).authToken;
    if (!rawToken) {
      throw new Error(
        "LMArena requires an auth token. Go to /settings and paste your arena.ai session token.",
      );
    }

    const auth = decodeSessionToken(rawToken);
    if (!auth) {
      throw new Error("Invalid LMArena token format. Paste the base64 session from arena.ai.");
    }

    // Build the evaluation request
    const evaluationSessionId = uuid7();
    const userMessageId = uuid7();
    const modelAMessageId = uuid7();

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
        "Authorization": `Bearer ${auth.accessToken}`,
        "Cookie": auth.cookie,
        "Origin": "https://arena.ai",
        "Referer": "https://arena.ai/",
      },
      body: JSON.stringify(data),
      signal: req.signal,
    });

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => "");
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          "LMArena token is invalid or expired. Go to /settings to update it with a fresh token.",
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

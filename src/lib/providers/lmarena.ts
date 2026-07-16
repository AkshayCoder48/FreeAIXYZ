/**
 * LMArena (arena.ai) provider.
 *
 * Uses the user-provided auth token from the /settings page.
 *
 * The token can be:
 *   1. A base64-encoded Supabase session JSON (what arena.ai stores)
 *   2. A raw JWT access_token (extracted from the session)
 *   3. Browser cookies from arena.ai (for advanced users)
 *
 * We try multiple auth methods until one works.
 */

import { randomBytes } from "crypto";
import type { Provider, ProviderCompletionRequest } from "./types";

const CREATE_EVALUATION = "https://arena.ai/nextjs-api/stream/create-evaluation";
const SB_PROJECT_ID = "huogzoeqzcrdvkwtvodi";

function uuid7(): string {
  const timestampMs = Date.now();
  const randA = randomBytes(2).readUInt16BE(0) & 0x0fff;
  const randB = randomBytes(8);
  randB[0] = (randB[0] & 0x3f) | 0x80;
  const ts = BigInt(timestampMs) << 80n;
  const ra = BigInt(0x7000 | randA) << 64n;
  const rb = BigInt("0x" + Array.from(randB).map((b) => b.toString(16).padStart(2, "0")).join(""));
  const uuidInt = ts | ra | rb;
  const hex = uuidInt.toString(16).padStart(32, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function parseLmaLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("a0:")) {
    try {
      const data = JSON.parse(trimmed.slice(3));
      if (typeof data === "string") return data;
      if (data?.text) return data.text;
      return null;
    } catch { return null; }
  }
  return null;
}

/** Extract the access_token from various token formats. */
function extractAccessToken(token: string): string | null {
  // If it looks like a raw cookie string (contains = and ;), extract the access_token
  if (token.includes(";") && token.includes("=")) {
    // It's a raw cookie header — use as-is for the Cookie header
    return null; // Signal that we should use the raw string as cookies
  }
  // Try as base64-encoded Supabase session
  try {
    const decoded = Buffer.from(token, "base64").toString("utf8");
    try {
      const session = JSON.parse(decoded);
      if (session.access_token) return session.access_token;
    } catch {}
    const accessMatch = decoded.match(/"access_token"\s*:\s*"([^"]+)"/);
    if (accessMatch) return accessMatch[1];
  } catch {}
  // If it looks like a JWT (starts with eyJ), use it directly
  if (token.startsWith("eyJ") && token.includes(".")) return token;
  return null;
}

export const lmarenaProvider: Provider = {
  id: "lmarena",

  async complete(req) {
    let text = "";
    for await (const chunk of this.stream(req)) { text += chunk; }
    return { text };
  },

  async *stream(req) {
    const rawToken = (req as ProviderCompletionRequest & { authToken?: string }).authToken;
    if (!rawToken || rawToken.trim() === "") {
      throw new Error(
        "LMArena requires an auth token. Go to /settings and paste your arena.ai token.",
      );
    }

    const accessToken = extractAccessToken(rawToken);

    // If the token looks like raw cookies (contains ; and =), use them directly
    const isRawCookies = rawToken.includes(";") && rawToken.includes("=");

    if (!accessToken && !isRawCookies) {
      throw new Error(
        "Could not extract access token from the provided value. " +
        "Paste either: (1) the base64 session from arena.ai cookies, " +
        "(2) the raw JWT access_token, or " +
        "(3) the full Cookie header from a DevTools Network request.",
      );
    }

    // Build the evaluation request
    const evaluationSessionId = uuid7();
    const userMessageId = uuid7();
    const modelAMessageId = uuid7();

    const lastUserMsg = [...req.messages].reverse().find((m) => m.role === "user");
    const prompt = lastUserMsg?.content || "Hello";
    const systemMsgs = req.messages.filter((m) => m.role === "system");
    const fullPrompt = systemMsgs.length > 0
      ? `${systemMsgs.map((m) => m.content).join("\n\n")}\n\n${prompt}`
      : prompt;

    const data = {
      id: evaluationSessionId,
      mode: "direct-battle",
      userMessageId,
      modelAMessageId,
      userMessage: { content: fullPrompt, experimental_attachments: [], metadata: {} },
      modality: "chat",
      recaptchaV3Token: "",
      modelAId: req.model.upstream,
    };

    // Try multiple auth methods — arena.ai may use different cookie formats
    const authMethods: { cookie: string; bearer: string }[] = [];

    if (isRawCookies) {
      // Raw cookies from DevTools — use as-is
      authMethods.push({ cookie: rawToken, bearer: "" });
    }

    if (accessToken) {
      // Supabase cookie formats — all values must be ASCII-safe for HTTP headers
      authMethods.push(
        // The raw base64 token as-is (what the browser stores)
        { cookie: `sb-${SB_PROJECT_ID}-auth-token=${rawToken}`, bearer: accessToken },
        // Just the access token JWT
        { cookie: `sb-${SB_PROJECT_ID}-auth-token=${accessToken}`, bearer: accessToken },
        // NextAuth format
        { cookie: `__Secure-next-auth.session-token=${accessToken}`, bearer: accessToken },
        // Bearer only
        { cookie: "", bearer: accessToken },
      );
    }

    let lastError = "";
    for (const auth of authMethods) {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        "Origin": "https://arena.ai",
        "Referer": "https://arena.ai/",
      };
      if (auth.bearer) headers["Authorization"] = `Bearer ${auth.bearer}`;
      if (auth.cookie) {
        try {
          headers["Cookie"] = auth.cookie;
        } catch {
          continue; // Skip cookie values with invalid characters
        }
      }

      try {
        const res = await fetch(CREATE_EVALUATION, {
          method: "POST",
          headers,
          body: JSON.stringify(data),
          signal: req.signal,
        });

        if (res.ok && res.body) {
          // Success — stream the response
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
          return; // Success — exit the generator
        }

        // Non-OK: record error and try next method
        const errText = await res.text().catch(() => "");
        lastError = `HTTP ${res.status}: ${errText.slice(0, 150)}`;
        if (res.status !== 401 && res.status !== 403) {
          // Non-auth error — don't try other methods
          throw new Error(`LMArena returned HTTP ${res.status}: ${errText.slice(0, 200)}`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // Skip ByteString/encoding errors — try next auth method
        if (msg.includes("ByteString") || msg.includes("greater than 255")) {
          continue;
        }
        if (!msg.includes("HTTP 4")) {
          throw e; // Non-HTTP error — rethrow
        }
        lastError = msg;
      }
    }

    // All auth methods failed
    throw new Error(
      `LMArena authentication failed (${lastError}). The token may be expired or in the wrong format. ` +
      "Go to /settings and paste a fresh token from arena.ai. " +
      "Tip: In arena.ai DevTools → Application → Cookies, copy the value of 'sb-huogzoeqzcrdvkwtvodi-auth-token' cookie.",
    );
  },
};

/**
 * Chat Smith provider (Vulcan Labs "Chat Smith" Android app backend).
 *
 * Imported from the GPT-AI repo (github.com/OshekharO/GPT-AI, scrapers/v6.js).
 * Live-verified 2026-10-13 — real GPT-4o-mini behind an app-backend auth flow:
 *
 *   1. POST https://api.vulcanlabs.co/smith-auth/api/v1/token
 *        { device_id, order_id:"", product_id:"", purchase_token:"", subscription_id:"" }
 *      → { AccessToken, AccessTokenExpiration }   (no real login — anonymous
 *        device token minted from the app's public device id)
 *   2. POST https://api.vulcanlabs.co/smith-v2/api/v7/chat_android
 *        { usage_model: { provider:"openai", model:"gpt-4o-mini" },
 *          user: DEVICE_ID, messages: [{role, content}],
 *          nsfw_check: true, tools: [{function:{name:"create_ai_art"}}] }
 *      → { choices: [{ Message: { content } }] }   (capital-M Message!)
 *
 * System prompts + multi-turn history verified working (scraper README:
 * "Supports Memory & System Prompts"). Non-streaming JSON response.
 */

import type { Provider, ProviderCompletionRequest } from "./types";

const TOKEN_URL = "https://api.vulcanlabs.co/smith-auth/api/v1/token";
const CHAT_URL = "https://api.vulcanlabs.co/smith-v2/api/v7/chat_android";
const DEVICE_ID = "A718E10669C7C5F7";

/** Public app tokens hardcoded in the GPT-AI scraper (scrapers/v6.js). */
const X_AUTH_TOKEN =
  "A4gnMV1ReuPphVWC/az7HiXbdiG4lpynFp0GA1k6EJ3P1os8bLHiYgAwJZ8Hi80hDMLzxEWsn+srJ5CxEVHDU/mBrrfSVHV1MJhm9WKM4dTHOcCc4RMpHDEg5GTNPsS19bUFsm8IW/SH5eY+BIwgPg4P4JT41c1eC83swjZ3FVA=";

const BASE_HEADERS: Record<string, string> = {
  "User-Agent": "Chat Smith Android, Version 4.0.1(970)",
  Accept: "application/json",
  "Accept-Encoding": "gzip",
  "Content-Type": "application/json; charset=utf-8",
  "x-vulcan-application-id": "com.smartwidgetlabs.chatgpt",
};

// ── token cache (module-level; tokens live ~1h, refreshed 5min early) ────────
let cachedToken: { token: string; expiresAt: number } | null = null;
let tokenFetch: Promise<string> | null = null;

async function fetchToken(force = false): Promise<string> {
  if (!force && cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }
  if (tokenFetch) return tokenFetch;
  tokenFetch = (async () => {
    try {
      const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { ...BASE_HEADERS, "x-vulcan-request-id": "9149487891752494707093" },
        body: JSON.stringify({
          device_id: DEVICE_ID,
          order_id: "",
          product_id: "",
          purchase_token: "",
          subscription_id: "",
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`Chat Smith auth returned HTTP ${res.status}: ${errText.slice(0, 200)}`);
      }
      const data = (await res.json()) as {
        AccessToken?: string;
        access_token?: string;
        token?: string;
        AccessTokenExpiration?: string;
      };
      const token = data.AccessToken ?? data.access_token ?? data.token;
      if (!token) throw new Error("Chat Smith auth returned no access token");
      let expiresAt = Date.now() + 55 * 60 * 1000; // default: 55min
      if (data.AccessTokenExpiration) {
        const exp = new Date(data.AccessTokenExpiration).getTime();
        if (Number.isFinite(exp)) expiresAt = exp - 5 * 60 * 1000;
      }
      cachedToken = { token, expiresAt };
      return token;
    } finally {
      tokenFetch = null;
    }
  })();
  return tokenFetch;
}

export const chatSmithProvider: Provider = {
  id: "chatsmith",

  async complete(req) {
    // Upstream needs at least one message.
    const messages = req.messages.length > 0 ? req.messages : [{ role: "user", content: "Hello" }];

    const payload = {
      usage_model: { provider: "openai", model: req.model.upstream },
      user: DEVICE_ID,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      nsfw_check: true,
      tools: [{ function: { name: "create_ai_art" } }],
    };

    const doChat = async (token: string) =>
      fetch(CHAT_URL, {
        method: "POST",
        headers: {
          ...BASE_HEADERS,
          "x-auth-token": X_AUTH_TOKEN,
          authorization: `Bearer ${token}`,
          "x-firebase-appcheck-error": "-9%3A+Integrity+API+error...",
          "x-vulcan-request-id": "9149487891752494721341",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.any([
          ...(req.signal ? [req.signal] : []),
          AbortSignal.timeout(60_000),
        ]),
      });

    let token = await fetchToken();
    let res = await doChat(token);
    // Token expired / invalidated mid-flight → force one refresh and retry.
    if (res.status === 401 || res.status === 403) {
      token = await fetchToken(true);
      res = await doChat(token);
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Chat Smith returned HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{
        Message?: { content?: unknown };
        message?: { content?: unknown };
      }>;
    };
    const choice = data.choices?.[0];
    const content = choice?.Message?.content ?? choice?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("Chat Smith returned no message content");
    }
    return { text: content };
  },

  async *stream(req) {
    // Upstream is non-streaming (single JSON) — one honest yield (PRD §137).
    const result = await this.complete(req);
    yield result.text;
  },
};

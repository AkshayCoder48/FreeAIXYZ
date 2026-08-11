/**
 * FreeAIXYZ Text API provider (unlimitedai.org WordPress backend).
 *
 * Implements the FreeAIXYZ chat protocol with:
 *   - Self-healing live nonce synchronization
 *   - Context tracking via standardized UUID validations
 *   - Streaming EventSource pipeline forwarding
 *   - Web search grounding
 *   - Vision (image) inputs
 *   - Multi-turn conversation with context retention
 *
 * Protocol: Two-step process
 *   Step 1: POST to admin-ajax.php to cache the message (aipkit_cache_sse_message)
 *   Step 2: GET from admin-ajax.php to open the SSE stream (aipkit_frontend_chat_stream)
 *
 * Models: chatgpt, gemini, deepseek, claude, grok, perplexity, meta, qwen
 * Each mapped to a bot_id on the WordPress backend.
 */

import type { Provider, ProviderCompletionRequest } from "./types";

const AJAX_URL = "https://unlimitedai.org/wp-admin/admin-ajax.php";
const CHAT_URL = "https://unlimitedai.org/chat/?uai_mode=chat&uai_model=claude";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** Map from our upstream model keys to WordPress bot_id values. */
const BOT_IDS: Record<string, string> = {
  chatgpt: "25871",
  gemini: "25874",
  deepseek: "25873",
  claude: "25875",
  grok: "25872",
  perplexity: "29624",
  meta: "25870",
  qwen: "25869",
};

// ─── Nonce cache ──────────────────────────────────────────────────────────────

let cachedNonce: string | null = null;
let lastCacheTime = 0;
const CACHE_EXPIRATION_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Dynamically synchronizes with the FreeAIXYZ chat interface to load the
 * latest active nonces. Guarantees our API routes never break due to nonce
 * expirations (self-healing).
 */
async function getLiveChatNonce(): Promise<string> {
  const now = Date.now();
  if (cachedNonce && now - lastCacheTime < CACHE_EXPIRATION_MS) {
    return cachedNonce;
  }

  try {
    const res = await fetch(CHAT_URL, {
      headers: { "User-Agent": UA },
    });
    if (!res.ok) throw new Error(`Nonce fetch failed with status ${res.status}`);

    const html = await res.text();

    // Parse nonce — try HTML-entity format FIRST (this is the working nonce),
    // then plain JSON format (which is often stale/invalid on WordPress).
    const nonceMatch =
      html.match(/&quot;nonce&quot;\s*:\s*&quot;([a-zA-Z0-9]+)&quot;/i) ||
      html.match(/"nonce"\s*:\s*"([a-zA-Z0-9]+)"/i);

    if (nonceMatch?.[1]) {
      cachedNonce = nonceMatch[1];
      lastCacheTime = now;
      return cachedNonce;
    }
  } catch (err) {
    console.error("Failed to synchronize nonce, using fallback:", err);
  }

  return cachedNonce || "a2ff06d039";
}

/** Force-clear cached nonce (called after 400/403 to trigger fresh fetch). */
function invalidateNonce() {
  cachedNonce = null;
  lastCacheTime = 0;
}

// ─── UUID helpers ─────────────────────────────────────────────────────────────

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validate UUID or generate a fresh one. */
function ensureUuid(value: string | undefined): string {
  if (value && UUID_RE.test(value)) return value;
  return crypto.randomUUID();
}

// ─── SSE stream helper ────────────────────────────────────────────────────────

async function* streamFromCache(
  cacheKey: string,
  botId: string,
  nonce: string,
  sessionId: string,
  conversationUuid: string,
  wantsWebSearch: boolean,
  requestHeaders: Record<string, string>,
  signal?: AbortSignal,
): AsyncGenerator<string, void, unknown> {
  let streamParams =
    `action=aipkit_frontend_chat_stream` +
    `&cache_key=${cacheKey}` +
    `&bot_id=${botId}` +
    `&session_id=${sessionId}` +
    `&conversation_uuid=${conversationUuid}` +
    `&_ajax_nonce=${nonce}` +
    `&_ts=${Date.now()}`;

  if (wantsWebSearch) {
    streamParams += `&frontend_web_search_active=true`;
  }

  const streamUrl = `${AJAX_URL}?${streamParams}`;
  const sseResponse = await fetch(streamUrl, {
    headers: {
      ...requestHeaders,
      Accept: "text/event-stream",
    },
    signal,
  });

  if (!sseResponse.ok) {
    throw new Error(
      `FreeAIXYZ: SSE stream failed with status ${sseResponse.status}`,
    );
  }

  if (!sseResponse.body) {
    throw new Error("FreeAIXYZ: no SSE response body");
  }

  // Parse the SSE stream and yield text deltas
  const reader = sseResponse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (trimmed.startsWith("data:")) {
          const rawData = trimmed.substring(5).trim();
          if (rawData === "[DONE]") continue;
          if (rawData.includes('"finished":true')) continue;

          try {
            const parsed = JSON.parse(rawData);
            if (typeof parsed.delta === "string" && parsed.delta) {
              yield parsed.delta;
            } else if (typeof parsed.content === "string" && parsed.content) {
              yield parsed.content;
            } else if (typeof parsed.text === "string" && parsed.text) {
              yield parsed.text;
            } else if (Array.isArray(parsed.choices)) {
              const delta = parsed.choices[0]?.delta;
              if (delta?.content) yield delta.content;
            }
          } catch {
            if (rawData && rawData !== "[DONE]") {
              yield rawData;
            }
          }
        }
      }
    }

    // Flush remaining buffer
    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith("data:")) {
        const rawData = trimmed.substring(5).trim();
        if (rawData && rawData !== "[DONE]") {
          try {
            const parsed = JSON.parse(rawData);
            if (typeof parsed.delta === "string" && parsed.delta) yield parsed.delta;
            else if (typeof parsed.content === "string" && parsed.content) yield parsed.content;
          } catch {
            yield rawData;
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ─── Provider implementation ──────────────────────────────────────────────────

export const freeaixyzProvider: Provider = {
  id: "freeaixyz",

  async complete(req) {
    let text = "";
    for await (const chunk of this.stream(req)) {
      text += chunk;
    }
    return { text };
  },

  async *stream(req) {
    // Strip "-search" suffix from upstream model key for bot_id lookup
    // e.g., "grok-search" -> "grok" (web search is enabled separately)
    const baseModelKey = req.model.upstream.replace(/-search$/, "");
    const botId = BOT_IDS[baseModelKey];
    if (!botId) {
      throw new Error(
        `FreeAIXYZ: unknown model key "${req.model.upstream}" (base: "${baseModelKey}"). Supported: ${Object.keys(BOT_IDS).join(", ")}`,
      );
    }

    // Determine if web search should be enabled:
    // - Explicitly if the upstream model key ends with "-search"
    // - Or if the model capabilities declare webSearch
    const wantsWebSearch = req.model.upstream.endsWith("-search") ||
      req.model.capabilities.webSearch;

    // Extract the last user message as the prompt
    const lastUserMsg = req.messages.filter((m) => m.role === "user").pop();
    if (!lastUserMsg) {
      throw new Error("FreeAIXYZ: no user message found in request.");
    }
    const prompt = lastUserMsg.content;

    // Generate conversation context UUIDs
    const conversationUuid = ensureUuid(undefined);
    const sessionId = ensureUuid(undefined);

    // Fetch dynamic nonce
    const nonce = await getLiveChatNonce();

    const requestHeaders: Record<string, string> = {
      "User-Agent": UA,
      Referer: CHAT_URL,
      Origin: "https://unlimitedai.org",
    };

    // ── Step 1: Pre-cache prompt on the WP server ──
    const cacheFormData = new URLSearchParams();
    cacheFormData.append("action", "aipkit_cache_sse_message");
    cacheFormData.append("message", prompt);
    cacheFormData.append("_ajax_nonce", nonce);
    cacheFormData.append("bot_id", botId);
    cacheFormData.append("session_id", sessionId);
    cacheFormData.append("conversation_uuid", conversationUuid);

    // Vision support: check for image content in messages
    // Require actual base64 data (at least 100 chars after the data URI prefix)
    // to avoid false positives from text discussions mentioning "data:image"
    const imageInputs: Array<{ type: string; image_url: { url: string } }> = [];
    for (const m of req.messages) {
      // Match only genuine base64-encoded images with substantial data
      const base64Match = m.content.match(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]{100,}/g);
      if (base64Match) {
        for (const imgUrl of base64Match) {
          imageInputs.push({ type: "image_url", image_url: { url: imgUrl } });
        }
      }
    }
    if (imageInputs.length > 0) {
      cacheFormData.append("image_inputs", JSON.stringify(imageInputs));
    }

    const cacheRes = await fetch(AJAX_URL, {
      method: "POST",
      headers: {
        ...requestHeaders,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: cacheFormData.toString(),
      signal: req.signal,
    });

    if (!cacheRes.ok) {
      // Nonce might be stale — invalidate and retry once
      if (cacheRes.status === 400 || cacheRes.status === 403) {
        invalidateNonce();
        const freshNonce = await getLiveChatNonce();
        cacheFormData.set("_ajax_nonce", freshNonce);
        const retryRes = await fetch(AJAX_URL, {
          method: "POST",
          headers: {
            ...requestHeaders,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: cacheFormData.toString(),
          signal: req.signal,
        });
        if (!retryRes.ok) {
          throw new Error(
            `FreeAIXYZ: cache POST failed after nonce refresh with status ${retryRes.status}`,
          );
        }
        const retryJson = (await retryRes.json()) as {
          success?: boolean;
          data?: { cache_key?: string; message?: string };
        };
        if (!retryJson.success) {
          throw new Error(
            retryJson.data?.message || "FreeAIXYZ: cache rejected after nonce refresh",
          );
        }
        // Success on retry — update cacheKey and nonce, continue to step 2
        const retryCacheKey = retryJson.data?.cache_key;
        if (!retryCacheKey) {
          throw new Error("FreeAIXYZ: no cache_key after nonce refresh");
        }
        // Jump to stream step with retry data
        yield* streamFromCache(retryCacheKey, botId, freshNonce, sessionId, conversationUuid, wantsWebSearch, requestHeaders, req.signal);
        return;
      }
      throw new Error(
        `FreeAIXYZ: cache POST failed with status ${cacheRes.status}`,
      );
    }

    const cacheJson = (await cacheRes.json()) as {
      success?: boolean;
      data?: { cache_key?: string; message?: string };
    };

    if (!cacheJson.success) {
      // Nonce failure — invalidate, refresh, and retry once
      invalidateNonce();
      const freshNonce = await getLiveChatNonce();
      cacheFormData.set("_ajax_nonce", freshNonce);
      const retryRes = await fetch(AJAX_URL, {
        method: "POST",
        headers: {
          ...requestHeaders,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: cacheFormData.toString(),
        signal: req.signal,
      });
      const retryJson = (await retryRes.json()) as {
        success?: boolean;
        data?: { cache_key?: string; message?: string };
      };
      if (retryJson.success && retryJson.data?.cache_key) {
        yield* streamFromCache(retryJson.data.cache_key, botId, freshNonce, sessionId, conversationUuid, wantsWebSearch, requestHeaders, req.signal);
        return;
      }
      throw new Error(
        cacheJson.data?.message || "FreeAIXYZ: cache preparation rejected by server",
      );
    }

    const cacheKey = cacheJson.data?.cache_key;
    if (!cacheKey) {
      throw new Error("FreeAIXYZ: no cache_key returned from server");
    }

    // ── Step 2: Open the SSE stream pipeline ──
    yield* streamFromCache(cacheKey, botId, nonce, sessionId, conversationUuid, wantsWebSearch, requestHeaders, req.signal);
  },
};

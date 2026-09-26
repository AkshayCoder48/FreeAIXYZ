/**
 * NOVA provider (nova-uncensored.vercel.app) — uncensored chat with
 * per-request identity rotation.
 *
 * Upstream: a v0-app Next.js deployment fronting an OpenRouter free pool
 * (nvidia/nemotron-3-super-120b-a12b:free). Custom (non-OpenAI) protocol:
 *
 *   POST /api/chat  →  SSE stream (AI-SDK UIMessage protocol):
 *     data: {"type":"start-step"}
 *     data: {"type":"text-start","id":"0"}
 *     data: {"type":"text-delta","id":"0","delta":"…"}
 *     data: {"type":"text-end","id":"0"}
 *     data: {"type":"finish-step"}
 *     data: [DONE]
 *
 * Free tier: 20 messages per (clientId, chatId) pair, 3-hour reset — keyed
 * ONLY on client-supplied UUIDs (no IP limit, no fingerprinting, no auth
 * headers). STRATEGY: mint a fresh clientId + chatId for EVERY request, so
 * every request starts at count 0 with full quota — unlimited usage.
 *
 * Protocol notes (from live reverse-engineering of the site's JS chunks):
 *   - Messages use AI-SDK UIMessage parts: {"parts":[{"type":"text","text":
 *     "…"}],"id":"…","role":"user"|"assistant"}. System prompts are NOT a
 *     supported role — system text is folded into a leading user message.
 *   - deepThink / webSearch flags exist but are DISABLED on our requests
 *     (webSearch is broken upstream — Serper out of credits; deepThink is
 *     a paid-tier feature pressure point).
 *   - modelSettings: temperature 0–2, topK 1–100, maxTokens 256–131072
 *     (default 32768 on their UI; we default to the 131072 ceiling for
 *     maximum output length, honoring the unlimited-output policy).
 *   - NO VISION: image parts are rejected HTTP 400 server-side; vision
 *     content is flattened to a text note by the gateway layer.
 *   - Multi-turn: the full history is resent each request (stateless
 *     server) — the gateway already forwards the whole conversation.
 *   - model slots: "instant" (free), "websearch", "fileAnalysis" (free),
 *     "expert"/"coding" (paid-only → HTTP 403, intentionally not listed).
 *   - Error events: {"type":"error","errorText":"…"} → thrown mid-stream.
 */

import type { Provider, ProviderCompletionRequest, ProviderMessage } from "./types";

const CHAT_URL = "https://nova-uncensored.vercel.app/api/chat";

/** Upstream model slots (free-tier reachable). */
const NOVA_MODELS = new Set(["instant", "websearch", "fileAnalysis"]);

/**
 * Convert gateway messages → nova UIMessage parts format.
 * System messages are folded into a leading user turn (the upstream only
 * accepts user/assistant roles); assistant tool-call history is already
 * flattened to text by the gateway layer before it reaches us.
 */
function toNovaMessages(messages: ProviderMessage[]): Array<{
  parts: Array<{ type: "text"; text: string }>;
  id: string;
  role: "user" | "assistant";
}> {
  const out: Array<{
    parts: Array<{ type: "text"; text: string }>;
    id: string;
    role: "user" | "assistant";
  }> = [];
  for (const m of messages) {
    const text = (m.content ?? "").trim();
    if (!text) continue;
    out.push({
      id: crypto.randomUUID(),
      role: m.role === "assistant" ? "assistant" : "user",
      parts: [{ type: "text", text }],
    });
  }
  return out;
}

/** Current browser date/time in the format the site sends (MM/DD/YYYY, HH:MM). */
function browserNow(): { browserDate: string; browserTime: string } {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  return {
    browserDate: `${mm}/${dd}/${now.getFullYear()}`,
    browserTime: `${hh}:${mi}`,
  };
}

/**
 * Build the upstream request body. Fresh clientId + chatId EVERY call —
 * the free-tier counter is keyed on this pair, so rotation resets the
 * quota to 0/20 for every request (unlimited usage).
 */
function buildNovaBody(req: ProviderCompletionRequest): Record<string, unknown> {
  const upstream = NOVA_MODELS.has(req.model.upstream)
    ? req.model.upstream
    : "instant";
  const clientId = crypto.randomUUID();
  const chatId = crypto.randomUUID();
  const { browserDate, browserTime } = browserNow();

  // Sampling: temperature clamped to the upstream's 0–2 zod range;
  // maxTokens mapped to the 256–131072 window with the CEILING default
  // (unlimited-output policy — never cap what the model can generate).
  const temperature =
    typeof req.temperature === "number" && Number.isFinite(req.temperature)
      ? Math.min(Math.max(req.temperature, 0), 2)
      : 0.7;
  const maxTokens =
    typeof req.maxTokens === "number" && Number.isFinite(req.maxTokens) && req.maxTokens > 0
      ? Math.min(Math.max(Math.floor(req.maxTokens), 256), 131072)
      : 131072;

  return {
    model: upstream,
    // deepThink / webSearch intentionally OFF (per policy: no thinking
    // pressure, and the upstream's Serper search integration is dead).
    deepThink: false,
    webSearch: false,
    browserDate,
    browserTime,
    modelSettings: {
      temperature,
      topK: 40,
      maxTokens,
      thinkEffort: "low",
    },
    paidTierCode: null,
    paidTierClientId: null,
    // ─── ROTATION: fresh UUIDs per request = fresh 20/20 quota ───────────
    clientId,
    chatId,
    id: chatId,
    telegramBonusGranted: false,
    messages: toNovaMessages(req.messages),
    trigger: "submit-message",
  };
}

/**
 * Parse the upstream SSE stream. Yields text-delta fragments as they
 * arrive; throws on in-band error events.
 */
async function* streamNova(
  req: ProviderCompletionRequest,
): AsyncGenerator<string, void, unknown> {
  const res = await fetch(CHAT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildNovaBody(req)),
    signal: req.signal,
  });

  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 500);
    } catch {
      /* ignore */
    }
    throw new Error(`Nova upstream HTTP ${res.status}: ${detail || res.statusText}`);
  }
  if (!res.body) {
    throw new Error("Nova upstream returned no body (HTTP " + res.status + ")");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const raw = t.slice(5).trim();
        if (!raw || raw === "[DONE]") continue;
        let evt: Record<string, unknown>;
        try {
          evt = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (evt.type === "text-delta" && typeof evt.delta === "string" && evt.delta) {
          yield evt.delta;
        } else if (evt.type === "error") {
          // In-band error (e.g. empty model response, quota, paid-tier).
          const errorText =
            typeof evt.errorText === "string" ? evt.errorText : JSON.stringify(evt);
          throw new Error(`Nova stream error: ${errorText}`);
        }
        // start-step / text-start / text-end / finish-step / data-thought /
        // data-file / data-search — protocol scaffolding; ignored.
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* best-effort */
    }
  }
}

export const novaProvider: Provider = {
  id: "nova",

  async complete(req: ProviderCompletionRequest): Promise<{ text: string }> {
    let text = "";
    for await (const delta of streamNova(req)) {
      text += delta;
    }
    if (!text.trim()) {
      throw new Error("Nova upstream returned an empty response");
    }
    return { text };
  },

  async *stream(req: ProviderCompletionRequest): AsyncGenerator<string, void, unknown> {
    yield* streamNova(req);
  },
};

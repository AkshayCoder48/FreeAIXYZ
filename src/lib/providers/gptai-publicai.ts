/**
 * PublicAI provider (publicai.co) — Apertus 70B via a Swiss-AI-Initiative
 * litellm pool.
 *
 * Imported from the GPT-AI repo (github.com/OshekharO/GPT-AI,
 * scrapers/v10.js). Live-verified 2026-10-13:
 *
 *   POST https://publicai.co/api/chat
 *   headers: user-agent "ai-sdk/5.0.55 runtime/browser"
 *   body: { tools: {}, id: <16-hex>, system: <optional system prompt>,
 *           messages: [{ id: <16-hex>, role: "user"|"assistant",
 *                        parts: [{type:"text", text}] }],
 *           trigger: "submit-message" }
 *   response: SSE (AI-SDK v5 UI stream):
 *     data: {"type":"start"}
 *     data: {"type":"start-step"}
 *     data: {"type":"text-start","id":"0"}
 *     data: {"type":"text-delta","id":"0","delta":"…"}   ← content deltas
 *     data: {"type":"text-end","id":"0"}
 *     data: {"type":"finish-step"}
 *     data: [DONE]
 *     data: {"type":"error","errorText":"…"}             ← failures
 *
 * IMPORTANT protocol details (verified live):
 *   - `system` messages INSIDE the messages array break the upstream litellm
 *     proxy (HTTP 200 + SSE error "This model only accepts a system message
 *     as the first message, with its content as a plain string" / "Received
 *     Model Group=swiss-ai/apertus-v1.5-70b"). The system prompt MUST be the
 *     TOP-LEVEL `system` field (AI-SDK v5 shape) — that works.
 *   - Multi-turn user/assistant history works (verified: teal recall).
 *   - The upstream model identifies itself as "Apertus, a language model
 *     developed by the Swiss AI Initiative" (swiss-ai/apertus-v1.5-70b).
 *   - Intermittent litellm flakes ("Failed after N attempts") DO happen —
 *     the adapter retries once before surfacing the error.
 */

import type { Provider, ProviderCompletionRequest } from "./types";

const ENDPOINT = "https://publicai.co/api/chat";

function randHex(len: number): string {
  const bytes = new Uint8Array(len / 2 + 1);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, len);
}

interface PublicaiStreamEvent {
  type?: string;
  delta?: string;
  errorText?: string;
}

/** Parse one SSE line into an event object (null when not applicable). */
function parsePublicaiLine(line: string): PublicaiStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const data = trimmed.slice(5).trim();
  if (!data || data === "[DONE]") return null;
  try {
    return JSON.parse(data) as PublicaiStreamEvent;
  } catch {
    return null;
  }
}

async function *fetchPublicaiStream(
  req: ProviderCompletionRequest,
): AsyncGenerator<string, void, unknown> {
  const systemTexts = req.messages
    .filter((m) => m.role === "system")
    .map((m) => (m.content ?? "").trim())
    .filter(Boolean);

  const convo = req.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      id: randHex(16),
      role: m.role === "assistant" ? "assistant" : "user",
      parts: [{ type: "text", text: m.content ?? "" }],
    }))
    .filter((m) => (m.parts[0]?.text ?? "").length > 0);
  if (convo.length === 0) {
    convo.push({ id: randHex(16), role: "user", parts: [{ type: "text", text: "Hello" }] });
  }

  const payload: Record<string, unknown> = {
    tools: {},
    id: randHex(16),
    messages: convo,
    trigger: "submit-message",
  };
  if (systemTexts.length > 0) payload.system = systemTexts.join("\n\n");

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "ai-sdk/5.0.55 runtime/browser",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.any([
      ...(req.signal ? [req.signal] : []),
      AbortSignal.timeout(60_000),
    ]),
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => "");
    throw new Error(`PublicAI returned HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawText = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const evt = parsePublicaiLine(line);
        if (!evt) continue;
        if (evt.type === "text-delta" && typeof evt.delta === "string" && evt.delta) {
          sawText = true;
          yield evt.delta;
        } else if (evt.type === "error") {
          throw new Error(`PublicAI stream error: ${evt.errorText ?? "unknown upstream error"}`);
        }
      }
    }
    const evt = parsePublicaiLine(buffer);
    if (evt?.type === "text-delta" && typeof evt.delta === "string" && evt.delta) {
      sawText = true;
      yield evt.delta;
    } else if (evt?.type === "error") {
      throw new Error(`PublicAI stream error: ${evt.errorText ?? "unknown upstream error"}`);
    }
  } finally {
    reader.releaseLock();
  }

  if (!sawText) {
    throw new Error("PublicAI returned no text deltas");
  }
}

export const publicaiProvider: Provider = {
  id: "publicai",

  async complete(req) {
    let text = "";
    // One retry — the upstream litellm pool intermittently flakes
    // ("Failed after N attempts") on individual requests.
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        text = "";
        for await (const chunk of fetchPublicaiStream(req)) {
          text += chunk;
        }
        return { text };
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("PublicAI request failed");
  },

  async *stream(req) {
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      let yielded = false;
      try {
        for await (const chunk of fetchPublicaiStream(req)) {
          yielded = true;
          yield chunk;
        }
        return;
      } catch (err) {
        lastErr = err;
        // Only retry when nothing was yielded yet (mid-stream retries would
        // duplicate content).
        if (yielded) throw err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("PublicAI request failed");
  },
};

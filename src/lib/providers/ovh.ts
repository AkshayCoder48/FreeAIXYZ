/**
 * OVHcloud AI Endpoints provider.
 *
 * Free, no-auth, OpenAI-compatible API hosted on OVHcloud Kepler AI.
 * 15 chat-capable models (Mistral, Llama, Qwen, gpt-oss) — all free,
 * no signup, no API key. 2 RPM per IP per model on the anonymous tier.
 *
 * Endpoint: POST https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions
 * Models:   GET  https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/models
 * Response: standard OpenAI SSE (streaming) or JSON (non-streaming)
 *
 * Credit: OVHcloud (https://www.ovhcloud.com/) — free AI Endpoints
 * with anonymous tier, hosted in EU (Kepler AI cloud).
 */

import type { Provider, ProviderCompletionRequest } from "./types";

const ENDPOINT = "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions";

function parseSseLine(line: string): string | null {
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

export const ovhProvider: Provider = {
  id: "ovh",

  async complete(req) {
    const payload = {
      model: req.model.upstream,
      messages: req.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: false,
    };

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: req.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`OVH AI returned HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = json?.choices?.[0]?.message?.content ?? "";
    return { text };
  },

  async *stream(req) {
    const payload = {
      model: req.model.upstream,
      messages: req.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: true,
    };

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: req.signal,
    });

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => "");
      throw new Error(`OVH AI returned HTTP ${res.status}: ${errText.slice(0, 200)}`);
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
          const delta = parseSseLine(line);
          if (delta) yield delta;
        }
      }
      const delta = parseSseLine(buffer);
      if (delta) yield delta;
    } finally {
      reader.releaseLock();
    }
  },
};

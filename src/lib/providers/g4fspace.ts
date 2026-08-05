/**
 * g4f.space provider — the g4f (GPT4Free) API server.
 *
 * Reverse-engineered from g4f.dev — this is the official g4f API server that
 * proxies 200+ models from 30+ reverse-engineered chat providers (Blackbox,
 * DuckDuckGo, Airforce, Liaobots, Pollinations, community-hosted Ollama
 * instances, etc.). No signup, no API key.
 *
 * Endpoint: POST https://g4f.space/v1/chat/completions
 * Models:   GET  https://g4f.space/v1/models
 *
 * Rate limit: 3 active days per 12 days for anonymous users. When exceeded,
 * returns HTTP 429 with a clear message. Model list endpoint always works.
 *
 * Credit: g4f.dev / xtekky/gpt4free — the community-driven free AI providers
 * project (https://github.com/xtekky/gpt4free).
 *
 * The g4f API server auto-routes requests to the best available provider for
 * each model, so the same model can be served by different backends at
 * different times (Groq, NVIDIA, Pollinations, community Ollama, etc.).
 */

import type { Provider, ProviderCompletionRequest } from "./types";

const ENDPOINT = "https://g4f.space/v1/chat/completions";

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

export const g4fSpaceProvider: Provider = {
  id: "g4fspace",

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
      if (res.status === 429 && errText.includes("rate_limit")) {
        throw new Error(
          "g4f.space anonymous limit reached (3 active days per 12 days). Please try again later or use a different provider.",
        );
      }
      throw new Error(`g4f.space returned HTTP ${res.status}: ${errText.slice(0, 200)}`);
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
      if (res.status === 429 && errText.includes("rate_limit")) {
        throw new Error(
          "g4f.space anonymous limit reached (3 active days per 12 days). Please try again later or use a different provider.",
        );
      }
      throw new Error(`g4f.space returned HTTP ${res.status}: ${errText.slice(0, 200)}`);
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

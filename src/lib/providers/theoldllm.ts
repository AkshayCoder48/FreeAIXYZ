/**
 * TheOldLLM provider — uses a headless-browser mini-service to bypass the
 * Vercel Security Checkpoint (WASM PoW + Cloudflare Turnstile).
 *
 * The mini-service (mini-services/theoldllm-browser, port 3004) keeps a
 * Playwright browser open with the challenge solved, and proxies API calls
 * through the browser's cleared context. The service auto-restarts on crash
 * via start.sh wrapper.
 *
 * Response: standard OpenAI SSE
 */

import type { Provider, ProviderCompletionRequest } from "./types";

const PROXY_URL = "http://127.0.0.1:3004";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

/** Fetch with retry — the browser service may crash and auto-restart. */
async function fetchWithRetry(
  payload: unknown,
  signal?: AbortSignal,
  maxRetries = 3,
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(PROXY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal,
      });
      return res;
    } catch (e) {
      const isConnRefused =
        e instanceof TypeError &&
        (e.cause as { code?: string })?.code === "ECONNREFUSED";
      if (isConnRefused && attempt < maxRetries) {
        // Service crashed — wait for auto-restart wrapper to bring it back
        // First restart is quick (2s), but challenge solve takes ~15s
        const waitMs = attempt === 0 ? 3000 : 18000;
        await sleep(waitMs);
        continue;
      }
      throw new Error(
        "TheOldLLM browser proxy is not running. Start it with: cd mini-services/theoldllm-browser && bash start.sh",
      );
    }
  }
  throw new Error("TheOldLLM proxy: retry attempts exhausted.");
}

export const theOldLlmProvider: Provider = {
  id: "freeaionline",

  async complete(req) {
    let text = "";
    for await (const chunk of this.stream(req)) {
      text += chunk;
    }
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

    const res = await fetchWithRetry(payload, req.signal);

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => "");
      throw new Error(`TheOldLLM proxy: HTTP ${res.status}: ${errText.slice(0, 200)}`);
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

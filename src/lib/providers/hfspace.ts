/**
 * HuggingFace Space provider — calls any HF Space's /api/chat endpoint.
 *
 * These spaces use a custom SSE format:
 *   data: {"content": "text delta", "billedTo": "user"}
 *   data: [DONE]
 *
 * Auth: Requires a HuggingFace session cookie (set via settings).
 * The space bills inference to the user's HF account.
 *
 * Models are configured per-space (each space hosts one model).
 */

import type { Provider, ProviderCompletionRequest } from "./types";

interface HFSpaceConfig {
  url: string;
  model: string;
}

// Known HF Spaces with /api/chat endpoints
const HF_SPACES: Record<string, HFSpaceConfig> = {
  "glm-5-2-hf": {
    url: "https://akhaliq-glm-5-2.hf.space/api/chat",
    model: "zai-org/GLM-5.2:fireworks-ai",
  },
};

/** Parse an HF Space SSE line. */
function parseSseLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const data = trimmed.slice(5).trim();
  if (!data || data === "[DONE]") return null;
  try {
    const json = JSON.parse(data);
    // HF Space format: {"content": "delta", "billedTo": "user"}
    if (json.content) return json.content;
    // Error format: {"error": "message"}
    if (json.error) throw new Error(json.error);
    return null;
  } catch (e) {
    if (e instanceof Error && e.message) throw e;
    return null;
  }
}

export const hfSpaceProvider: Provider = {
  id: "hfspace",

  async complete(req) {
    let text = "";
    for await (const chunk of this.stream(req)) {
      text += chunk;
    }
    return { text };
  },

  async *stream(req) {
    const config = HF_SPACES[req.model.upstream];
    if (!config) {
      throw new Error(`Unknown HF Space: ${req.model.upstream}`);
    }

    // Build the payload — HF Space /api/chat format
    const payload = {
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      model: config.model,
      temperature: 0.7,
    };

    // Use the auth token from the request if provided
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
    };

    // If the user provided an HF token, use it
    if (req.authToken) {
      headers["Authorization"] = `Bearer ${req.authToken}`;
    }

    const res = await fetch(config.url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: req.signal,
    });

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => "");
      throw new Error(`HF Space returned HTTP ${res.status}: ${errText.slice(0, 200)}`);
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

/**
 * Generic OpenAI-compatible provider — works with any provider that uses
 * the standard OpenAI API format with a Bearer token.
 *
 * Supported providers (user provides their own API key):
 *   - OpenRouter: https://openrouter.ai/api/v1 (14 free models)
 *   - Groq: https://api.groq.com/openai/v1 (fast inference, free tier)
 *   - Together AI: https://api.together.xyz/v1 (free tier)
 *   - Mistral: https://api.mistral.ai/v1 (free tier)
 *   - Cerebras: https://api.cerebras.ai/v1 (fastest inference, free tier)
 *   - Novita AI: https://api.novita.ai/v3/openai (141 models, free tier)
 *   - DeepInfra: https://api.deepinfra.com/v1/openai (free tier)
 *   - Fireworks: https://api.fireworks.ai/inference/v1 (free tier)
 *   - SambaNova: https://api.sambanova.ai/v1 (free tier)
 *
 * The API key is passed via the x-provider-token header or Authorization header.
 * Each provider has its own set of models.
 */

import type { Provider, ProviderCompletionRequest } from "./types";

export interface TokenProviderConfig {
  baseUrl: string;
  name: string;
  keyHeader?: string; // header name for the API key (default: Authorization)
  keyPrefix?: string; // prefix to add (default: "Bearer ")
}

// Provider configurations
export const TOKEN_PROVIDERS: Record<string, TokenProviderConfig> = {
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    name: "OpenRouter",
  },
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    name: "Groq",
  },
  together: {
    baseUrl: "https://api.together.xyz/v1",
    name: "Together AI",
  },
  mistral: {
    baseUrl: "https://api.mistral.ai/v1",
    name: "Mistral AI",
  },
  cerebras: {
    baseUrl: "https://api.cerebras.ai/v1",
    name: "Cerebras",
  },
  novita: {
    baseUrl: "https://api.novita.ai/v3/openai",
    name: "Novita AI",
  },
  deepinfra: {
    baseUrl: "https://api.deepinfra.com/v1/openai",
    name: "DeepInfra",
  },
  fireworks: {
    baseUrl: "https://api.fireworks.ai/inference/v1",
    name: "Fireworks AI",
  },
  sambanova: {
    baseUrl: "https://api.sambanova.ai/v1",
    name: "SambaNova",
  },
  siliconflow: {
    baseUrl: "https://api.siliconflow.cn/v1",
    name: "SiliconFlow",
  },
  aihubmix: {
    baseUrl: "https://aihubmix.com/v1",
    name: "AIHubMix",
  },
  huggingface: {
    baseUrl: "https://router.huggingface.co/v1",
    name: "HuggingFace",
  },
};

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

/** Extract the provider ID from the model upstream.
 * Format: "provider:model_id" (e.g., "groq:llama-3.1-8b-instant")
 */
function parseProviderModel(upstream: string): { providerId: string; modelId: string } {
  const colonIdx = upstream.indexOf(":");
  if (colonIdx === -1) {
    return { providerId: "openrouter", modelId: upstream };
  }
  return {
    providerId: upstream.slice(0, colonIdx),
    modelId: upstream.slice(colonIdx + 1),
  };
}

export const tokenProvider: Provider = {
  id: "openrouter",

  async complete(req) {
    let text = "";
    for await (const chunk of this.stream(req)) {
      text += chunk;
    }
    return { text };
  },

  async *stream(req) {
    const { providerId, modelId } = parseProviderModel(req.model.upstream);
    const config = TOKEN_PROVIDERS[providerId];
    if (!config) {
      throw new Error(`Unknown token provider: ${providerId}`);
    }

    if (!req.authToken) {
      throw new Error(
        `${config.name} requires an API key. Pass it via the x-provider-token header or Authorization: Bearer header.`,
      );
    }

    const payload = {
      model: modelId,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${req.authToken}`,
      "User-Agent": "FreeAIXYZ-Gateway/1.0",
    };

    // OpenRouter specific headers
    if (providerId === "openrouter") {
      headers["HTTP-Referer"] = "https://freeaixyz.vercel.app";
      headers["X-Title"] = "FreeAIXYZ Gateway";
    }

    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: req.signal,
    });

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `${config.name} returned HTTP ${res.status}: ${errText.slice(0, 200)}`,
      );
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

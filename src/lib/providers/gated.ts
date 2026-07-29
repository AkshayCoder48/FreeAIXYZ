/**
 * Gated provider — proxy to user-supplied-key upstreams.
 *
 * Three backends are supported:
 *   - Z.AI (provider id `zai`): https://chat.z.ai/api/v2/chat/completions
 *     Uses an OpenAI-compatible payload + SSE response, but requires the
 *     user's JWT (grabbed from chat.z.ai local storage) as Bearer token.
 *   - OpenRouter (provider id `openrouter-key`):
 *     https://openrouter.ai/api/v1/chat/completions — fully OpenAI-compatible.
 *   - Groq (provider id `groq-key`):
 *     https://api.groq.com/openai/v1/chat/completions — fully OpenAI-compatible.
 *
 * All three send the user-supplied key as `Authorization: Bearer <key>` (set
 * by the chat route via `req.authToken`). If no key is present the provider
 * throws a clear, actionable error that bubbles up to the API route's 401.
 *
 * The gateway never logs or persists the key — it is forwarded to the
 * upstream API only.
 */

import type { Provider, ProviderCompletionRequest } from "./types";
import type { ProviderId } from "./registry";

interface GatedConfig {
  baseUrl: string;
  name: string;
  /** The HTTP header the gateway reads the user-supplied key from. */
  keyHeader: string;
}

export const GATED_PROVIDERS: Record<
  "zai" | "openrouter-key" | "groq-key",
  GatedConfig
> = {
  zai: {
    baseUrl: "https://chat.z.ai/api/v2",
    name: "Z.AI",
    keyHeader: "x-zai-token",
  },
  "openrouter-key": {
    baseUrl: "https://openrouter.ai/api/v1",
    name: "OpenRouter",
    keyHeader: "x-openrouter-key",
  },
  "groq-key": {
    baseUrl: "https://api.groq.com/openai/v1",
    name: "Groq",
    keyHeader: "x-groq-key",
  },
};

/** Error thrown when the user hasn't supplied an API key. */
export class GatedKeyMissingError extends Error {
  readonly providerName: string;
  readonly keyHeader: string;
  constructor(providerName: string, keyHeader: string) {
    super(
      `This model requires an API key. Go to /settings to add your ${providerName} key.`,
    );
    this.name = "GatedKeyMissingError";
    this.providerName = providerName;
    this.keyHeader = keyHeader;
  }
}

function endpointFor(provider: ProviderId): string {
  if (provider === "zai") return `${GATED_PROVIDERS.zai.baseUrl}/chat/completions`;
  if (provider === "openrouter-key")
    return `${GATED_PROVIDERS["openrouter-key"].baseUrl}/chat/completions`;
  if (provider === "groq-key")
    return `${GATED_PROVIDERS["groq-key"].baseUrl}/chat/completions`;
  throw new Error(`Unknown gated provider: ${provider}`);
}

function configFor(provider: ProviderId): GatedConfig {
  if (provider === "zai") return GATED_PROVIDERS.zai;
  if (provider === "openrouter-key") return GATED_PROVIDERS["openrouter-key"];
  if (provider === "groq-key") return GATED_PROVIDERS["groq-key"];
  throw new Error(`Unknown gated provider: ${provider}`);
}

/** Build the headers for an upstream gated request. */
function buildHeaders(provider: ProviderId, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  if (provider === "openrouter-key") {
    // OpenRouter requests an optional ranking title + referrer.
    headers["X-Title"] = "FreeAIXYZ Gateway";
    headers["HTTP-Referer"] = "https://freeaixyz.app";
  }
  return headers;
}

/** Standard OpenAI SSE line parser. Returns the content delta if present. */
function parseOpenAISseLine(line: string): string | null {
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

/** Extract assistant text from a non-streaming OpenAI-compatible JSON body. */
function extractNonStreamText(json: unknown): string {
  type OpenAiShape = { choices?: Array<{ message?: { content?: string } }> };
  const data = json as OpenAiShape | undefined;
  const text = data?.choices?.[0]?.message?.content;
  return typeof text === "string" ? text : "";
}

/** Shared gated provider factory — used for all three gated backends. */
function makeGatedProvider(providerId: "zai" | "openrouter-key" | "groq-key"): Provider {
  const config = configFor(providerId);
  const endpoint = endpointFor(providerId);

  return {
    id: providerId,

    async complete(req) {
      const apiKey = req.authToken?.trim();
      if (!apiKey) {
        throw new GatedKeyMissingError(config.name, config.keyHeader);
      }

      const payload = {
        model: req.model.upstream,
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
        stream: false,
      };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: buildHeaders(providerId, apiKey),
        body: JSON.stringify(payload),
        signal: req.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(
          `${config.name} returned HTTP ${res.status}: ${errText.slice(0, 300)}`,
        );
      }

      const data = (await res.json()) as unknown;
      return { text: extractNonStreamText(data) };
    },

    async *stream(req) {
      const apiKey = req.authToken?.trim();
      if (!apiKey) {
        throw new GatedKeyMissingError(config.name, config.keyHeader);
      }

      const payload = {
        model: req.model.upstream,
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
      };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: buildHeaders(providerId, apiKey),
        body: JSON.stringify(payload),
        signal: req.signal,
      });

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "");
        throw new Error(
          `${config.name} returned HTTP ${res.status}: ${errText.slice(0, 300)}`,
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
            const delta = parseOpenAISseLine(line);
            if (delta) yield delta;
          }
        }
        const delta = parseOpenAISseLine(buffer);
        if (delta) yield delta;
      } finally {
        reader.releaseLock();
      }
    },
  };
}

export const zaiProvider: Provider = makeGatedProvider("zai");
export const openRouterKeyProvider: Provider = makeGatedProvider("openrouter-key");
export const groqKeyProvider: Provider = makeGatedProvider("groq-key");

/** Check whether a provider id is gated (requires a user-supplied key). */
export function isGatedProvider(id: ProviderId): boolean {
  return id === "zai" || id === "openrouter-key" || id === "groq-key";
}

/**
 * Shared OpenAI-compatible chat + streaming helper for BYOK adapters.
 *
 * Both Gratisfy (https://api.gratisfy.xyz/v1) and G4F (https://g4f.space/v1)
 * expose an OpenAI-shaped POST /v1/chat/completions with SSE streaming. This
 * helper centralizes the request build + SSE parse + usage collection so the
 * two adapters differ only in base URL, auth, and a few source-specific
 * payload fields.
 *
 * Usage accounting (PRD §39): SSE chunks are accumulated; usage is collected
 * once at stream end (never per-chunk). If upstream emits a `usage` chunk it
 * is used; otherwise usage is estimated (PRD §40) and clearly marked.
 */

import { calculateCost } from "./credit";
import type { Source } from "./types";

export interface ByokChatRequest {
  baseUrl: string; // e.g. "https://api.gratisfy.xyz/v1"
  apiKey: string; // the user's BYOK key (gxyz-… or g4f_…)
  model: string; // upstream model id
  messages: Array<{ role: string; content: string }>;
  stream: boolean;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  signal?: AbortSignal;
  /** Extra source-specific payload fields (e.g. routing.providers for gratisfy). */
  extra?: Record<string, unknown>;
  /** For G4F: the provider slug (e.g. "Gemini") passed as `provider`. */
  provider?: string;
}

export interface ByokChatResult {
  /** Incremental text deltas (for streaming). */
  stream?: AsyncGenerator<string, void, unknown>;
  /** Final usage collected from the upstream usage chunk (if any). */
  usage?: { inputTokens: number; outputTokens: number; cacheTokens: number; estimated: boolean; upstreamCost?: number };
  /** Full text (non-streaming path). */
  text?: string;
  requestId?: string;
}

/** Build the OpenAI-shaped payload (source-specific extras merged in). */
function buildPayload(req: ByokChatRequest): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    model: req.model,
    messages: req.messages,
    stream: req.stream,
  };
  if (req.temperature !== undefined) payload.temperature = req.temperature;
  if (req.maxTokens !== undefined) payload.max_tokens = req.maxTokens;
  if (req.topP !== undefined) payload.top_p = req.topP;
  if (req.provider) payload.provider = req.provider; // G4F provider selection
  if (req.extra) Object.assign(payload, req.extra);
  return payload;
}

/** Estimate tokens for usage when upstream doesn't return them (PRD §40). */
export function estimateTokens(text: string): number {
  // ~4 chars/token (rough heuristic for mixed English/code).
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * Estimate the XYZ cost of a generation AFTER it completes, from accumulated
 * text + (if available) the upstream-reported usage. Centralized so both
 * adapters charge identically (PRD §23, §32, §40).
 */
export function tallyUsage(
  modelId: string,
  source: Source,
  accumulatedText: string,
  promptText: string,
  upstreamUsage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number },
): {
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  estimated: boolean;
} {
  let inputTokens = 0;
  let outputTokens = 0;
  let estimated = false;
  if (
    upstreamUsage &&
    typeof upstreamUsage.prompt_tokens === "number" &&
    typeof upstreamUsage.completion_tokens === "number"
  ) {
    inputTokens = upstreamUsage.prompt_tokens;
    outputTokens = upstreamUsage.completion_tokens;
  } else {
    estimated = true;
    inputTokens = estimateTokens(promptText);
    outputTokens = estimateTokens(accumulatedText);
  }
  return { inputTokens, outputTokens, cacheTokens: 0, estimated };
}

/**
 * Run a streaming BYOK chat against an OpenAI-compatible upstream. Yields
 * text deltas. Captures usage from the upstream usage chunk (PRD §39, §40).
 */
export async function* streamByokChat(
  req: ByokChatRequest,
): AsyncGenerator<string, ByokChatResult["usage"], unknown> {
  const payload = buildPayload(req);
  const res = await fetch(`${req.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${req.apiKey}`,
      Accept: "text/event-stream",
    },
    body: JSON.stringify(payload),
    signal: req.signal,
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => "");
    throw new ByokUpstreamError(res.status, errText, req.model);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let usage: ByokChatResult["usage"] | undefined;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const parsed = parseSseLine(line);
        if (parsed?.content) yield parsed.content;
        if (parsed?.usage) usage = parsed.usage;
      }
    }
    const parsed = parseSseLine(buffer);
    if (parsed?.content) yield parsed.content;
    if (parsed?.usage) usage = parsed.usage;
  } finally {
    reader.releaseLock();
  }

  return usage;
}

/** Non-streaming BYOK chat. */
export async function completeByokChat(
  req: ByokChatRequest,
): Promise<{ text: string; usage?: ByokChatResult["usage"]; requestId?: string }> {
  const payload = buildPayload(req);
  const res = await fetch(`${req.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${req.apiKey}`,
    },
    body: JSON.stringify(payload),
    signal: req.signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new ByokUpstreamError(res.status, errText, req.model);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    id?: string;
  };
  const text = json.choices?.[0]?.message?.content ?? "";
  const usage = json.usage
    ? {
        inputTokens: json.usage.prompt_tokens ?? 0,
        outputTokens: json.usage.completion_tokens ?? 0,
        cacheTokens: 0,
        estimated: false,
      }
    : undefined;
  return { text, usage, requestId: json.id };
}

/** Parse one SSE line from an OpenAI-compatible upstream. */
function parseSseLine(
  line: string,
): { content?: string; usage?: NonNullable<ByokChatResult["usage"]> } | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const data = trimmed.slice(5).trim();
  if (!data || data === "[DONE]") return null;
  try {
    const json = JSON.parse(data);
    const choice = json?.choices?.[0];
    const delta = choice?.delta?.content;
    // G4F emits a top-level usage chunk (with cost) before [DONE].
    if (json?.usage && !choice) {
      return {
        usage: {
          inputTokens: json.usage.prompt_tokens ?? 0,
          outputTokens: json.usage.completion_tokens ?? 0,
          cacheTokens: 0,
          estimated: false,
          upstreamCost:
            typeof json.usage.cost === "number" ? json.usage.cost : undefined,
        },
      };
    }
    if (json?.usage && choice?.finish_reason) {
      // Some upstreams attach usage to the final choice chunk.
      return {
        content: typeof delta === "string" ? delta : undefined,
        usage: {
          inputTokens: json.usage.prompt_tokens ?? 0,
          outputTokens: json.usage.completion_tokens ?? 0,
          cacheTokens: 0,
          estimated: false,
        },
      };
    }
    if (typeof delta === "string" && delta) return { content: delta };
    return null;
  } catch {
    return null;
  }
}

/** Upstream error carrying the real status + message (PRD §62). */
export class ByokUpstreamError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly model: string,
  ) {
    super(`Upstream HTTP ${status}: ${body.slice(0, 200)}`);
    this.name = "ByokUpstreamError";
  }
}

/** Resolve which key to use for a request (header takes priority over stored). */
export function resolveByokKey(
  headerKey: string | null,
  storedKey: string | null,
): string {
  return (headerKey ?? storedKey ?? "").trim();
}

/**
 * Gratisfy BYOK adapter (PRD §4, §11, §27).
 *
 * Base URL:  https://api.gratisfy.xyz/v1  (researched R1 — see worklog.md)
 * Auth:      Authorization: Bearer gxyz-<key>
 * Chat:      POST /v1/chat/completions  (OpenAI-shaped; supports routing.*)
 * Discovery: GET  /v1/models?modality=language  (auth-required)
 * Pricing:   NOT documented per-model (BYOK → upstream's responsibility).
 *            Resolved as not_documented (PRD §27), unless matched against the
 *            central pricing board by upstream model name.
 *
 * Source-aware ids use the form `gratisfy:<provider>:<model>` where
 * `<provider>` is the namespace extracted from Gratisfy's `provider/model-id`
 * model id form, or "router" for aliases (PRD §18).
 */

import { completeByokChat, streamByokChat } from "./openai-chat";
import { getSuppliedPricingBoard, resolveSuppliedPricing } from "./pricing-board";
import type { ModelPricing, Source, UnifiedModel } from "./types";

// Cache the supplied board keys once (static).
let SUPPLIED_IDS: string[] | null = null;
function suppliedIds(): string[] {
  if (SUPPLIED_IDS) return SUPPLIED_IDS;
  SUPPLIED_IDS = Object.keys(getSuppliedPricingBoard());
  return SUPPLIED_IDS;
}

export const GRATISFY_BASE_URL = "https://api.gratisfy.xyz/v1";

/** Gratisfy model-id forms: "alias", "provider/model-id", or "router/free". */
function parseGratisfyModelId(id: string): { provider: string; model: string } {
  if (id.includes("/")) {
    const [provider, ...rest] = id.split("/");
    return { provider, model: rest.join("/") };
  }
  return { provider: "router", model: id };
}

/**
 * Discover Gratisfy models (PRD §11). REQUIRES the user's key (the
 * /v1/models endpoint is auth-gated). Returns UnifiedModel[] — one entry per
 * (gratisfy, provider, model). Same upstream model from a different source
 * stays independent (PRD §2).
 *
 * Pricing resolution (PRD §27): Gratisfy itself documents no per-model price.
 * We try to match the upstream model id against the central pricing board
 * (e.g. a Gratisfy "google-ai-studio/gemini-2.5-flash" → match "gemini-2.5-flash");
 * if matched, status=supplied; else not_documented (NEVER fabricated).
 */
export async function discoverGratisfyModels(
  apiKey: string,
  signal?: AbortSignal,
): Promise<UnifiedModel[]> {
  if (!apiKey) return [];
  let res: Response;
  try {
    res = await fetch(`${GRATISFY_BASE_URL}/models?modality=language`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    });
  } catch {
    return [];
  }
  if (!res.ok) return [];
  const json = (await res.json()) as {
    data?: Array<{ id: string; object?: string }>;
  };
  const list = json.data ?? [];
  const out: UnifiedModel[] = [];
  for (const m of list) {
    const id = m.id;
    if (!id) continue;
    const { provider, model } = parseGratisfyModelId(id);
    out.push({
      id: `gratisfy:${provider}:${model}`,
      displayName: model,
      source: "gratisfy" as Source,
      provider,
      originalModelId: id,
      capabilities: {
        text: true,
        vision: false, // not advertised per-model by Gratisfy discovery
        audio: false,
        video: false,
        image: false,
        reasoning: false,
        webSearch: false,
        streaming: true,
      },
      streaming: true,
      pricing: resolveGratisfyPricing(model),
      available: true,
      discoveredAt: new Date().toISOString(),
      metadata: { raw: m },
    });
  }
  return out;
}

/**
 * Resolve pricing for a Gratisfy model. Gratisfy documents no per-model
 * price; try matching the model name against the central supplied board
 * (e.g. "gemini-2.5-flash" → tb-style entry may exist). Otherwise
 * not_documented (PRD §26, §27).
 */
export function resolveGratisfyPricing(modelName: string): ModelPricing {
  // Try matching the model name against a central-board entry by its
  // trailing segment (e.g. "gemini-2.5-flash" → "tb/gemini-2.5-flash").
  for (const boardId of suppliedIds()) {
    const tail = boardId.split("/").pop() ?? boardId;
    if (tail && modelName.includes(tail)) {
      return resolveSuppliedPricing(boardId);
    }
  }
  return {
    inputPerMillion: null,
    outputPerMillion: null,
    cachePerMillion: null,
    currency: "USD",
    status: "not_documented",
    source: "unknown",
  };
}

/** Stream a Gratisfy chat (OpenAI-compatible). */
export function streamGratisfyChat(req: {
  apiKey: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  signal?: AbortSignal;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
}) {
  return streamByokChat({
    baseUrl: GRATISFY_BASE_URL,
    apiKey: req.apiKey,
    model: req.model,
    messages: req.messages,
    stream: true,
    signal: req.signal,
    temperature: req.temperature,
    maxTokens: req.maxTokens,
    topP: req.topP,
  });
}

/** Non-streaming Gratisfy chat. */
export function completeGratisfyChat(req: {
  apiKey: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  signal?: AbortSignal;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
}) {
  return completeByokChat({
    baseUrl: GRATISFY_BASE_URL,
    apiKey: req.apiKey,
    model: req.model,
    messages: req.messages,
    stream: false,
    signal: req.signal,
    temperature: req.temperature,
    maxTokens: req.maxTokens,
    topP: req.topP,
  });
}

/** Validate a Gratisfy key by hitting the auth-gated /v1/models (PRD §63). */
export async function validateGratisfyKey(
  apiKey: string,
): Promise<{ ok: boolean; error?: string; count?: number }> {
  try {
    const res = await fetch(`${GRATISFY_BASE_URL}/models?modality=language`, {
      headers: { Authorization: `Bearer ${apiKey.trim()}` },
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "Invalid API key" };
    }
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const json = (await res.json()) as { data?: unknown[] };
    return { ok: true, count: json.data?.length ?? 0 };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

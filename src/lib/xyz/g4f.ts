/**
 * G4F BYOK adapter (PRD §5, §12, §13, §28).
 *
 * Base URL:   https://g4f.space/v1            (researched R2 — see worklog.md)
 * Discovery:  https://g4f.space/backend-api/v2/*  (PUBLIC, no auth)
 * Auth:       Authorization: Bearer g4f_<key>  (for /v1/* hosted endpoint)
 * Chat:       POST /v1/chat/completions  (OpenAI-shaped + `provider` field)
 * Streaming:  SSE data:{chunk}\n\n + final usage chunk (with upstream cost)
 * Pricing:    NOT documented per-model (only usage.cost in the stream).
 *             Resolved as not_documented unless matched against the board.
 *
 * Source-aware ids: `g4f:<provider>:<model>` (PRD §18).
 * NOTE (R2): /v1/* REJECTS raw upstream keys (e.g. sk-…) with 403 — only
 * g4f_-prefixed member keys work on /v1/*. Users mint a g4f_ key at
 * g4f.dev/members.html.
 */

import { completeByokChat, streamByokChat } from "./openai-chat";
import { getSuppliedPricingBoard, resolveSuppliedPricing } from "./pricing-board";
import type {
  ModelCapabilities,
  ModelPricing,
  Source,
  UnifiedModel,
  UnifiedProvider,
} from "./types";

export const G4F_HOST = "https://g4f.space";
export const G4F_BASE_URL = `${G4F_HOST}/v1`;
export const G4F_DISCOVERY = `${G4F_HOST}/backend-api/v2`;

let SUPPLIED_IDS: string[] | null = null;
function suppliedIds(): string[] {
  if (SUPPLIED_IDS) return SUPPLIED_IDS;
  SUPPLIED_IDS = Object.keys(getSuppliedPricingBoard());
  return SUPPLIED_IDS;
}

interface G4fProviderInfo {
  active_by_default?: boolean;
  audio?: boolean;
  auth?: boolean;
  image?: boolean;
  label?: string;
  live?: boolean;
  login?: boolean;
  name?: string;
  parent?: string;
  video?: boolean;
  vision?: boolean;
}

interface G4fModelInfo {
  audio?: boolean;
  id?: string;
  image?: boolean;
  label?: string;
  vision?: boolean;
  default?: boolean;
}

/**
 * Discover all G4F models + providers (PRD §12, §51). PUBLIC — no auth.
 * Returns UnifiedModel[] (one entry per g4f provider:model) +
 * UnifiedProvider[] (one entry per g4f provider with capability flags).
 */
export async function discoverG4f(
  signal?: AbortSignal,
): Promise<{ models: UnifiedModel[]; providers: UnifiedProvider[] }> {
  // Fetch the provider list + the {provider: [models]} map in parallel.
  const [providersRes, modelsRes] = await Promise.all([
    safeFetch(`${G4F_DISCOVERY}/providers`, signal),
    safeFetch(`${G4F_DISCOVERY}/models`, signal),
  ]);
  const providersInfo = (providersRes ?? []) as G4fProviderInfo[];
  const modelsMap = (modelsRes ?? {}) as Record<string, string[]>;

  const providers: UnifiedProvider[] = [];
  const now = new Date().toISOString();
  for (const p of providersInfo) {
    const name = p.name ?? "unknown";
    const caps = capFlags(p);
    providers.push({
      id: `g4f:${name}`,
      name: p.label ?? name,
      source: "g4f" as Source,
      requiresApiKey: !!(p.auth || p.login),
      supportsModelDiscovery: true,
      supportsStreaming: true,
      capabilities: caps,
      models: (modelsMap[name] ?? []).map((m) => `g4f:${name}:${m}`),
      lastDiscoveredAt: now,
    });
  }

  const models: UnifiedModel[] = [];
  for (const [provider, modelIds] of Object.entries(modelsMap)) {
    const pInfo = providersInfo.find((p) => p.name === provider);
    const pCaps = capFlags(pInfo);
    for (const m of modelIds) {
      models.push({
        id: `g4f:${provider}:${m}`,
        displayName: m,
        source: "g4f" as Source,
        provider,
        originalModelId: m,
        capabilities: {
          text: true,
          vision: !!pCaps.vision,
          audio: !!pCaps.audio,
          video: !!pCaps.video,
          image: !!pCaps.image,
          reasoning: false,
          webSearch: false,
          streaming: true,
        },
        streaming: true,
        pricing: resolveG4fPricing(m),
        available: true,
        discoveredAt: now,
        metadata: { providerInfo: pInfo ?? null },
      });
    }
  }
  return { models, providers };
}

function capFlags(p?: G4fProviderInfo): string[] {
  const out: string[] = [];
  if (p?.vision) out.push("vision");
  if (p?.image) out.push("image");
  if (p?.audio) out.push("audio");
  if (p?.video) out.push("video");
  if (p?.auth || p?.login) out.push("auth");
  return out;
}

/**
 * Resolve G4F pricing (PRD §28). G4F documents no per-model price. Match the
 * model id against the central board; otherwise not_documented (never $0).
 */
export function resolveG4fPricing(modelId: string): ModelPricing {
  for (const boardId of suppliedIds()) {
    const tail = boardId.split("/").pop() ?? boardId;
    if (tail && modelId.includes(tail)) {
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

/** Stream a G4F chat (OpenAI-compatible; `provider` selects the upstream). */
export function streamG4fChat(req: {
  apiKey: string;
  model: string;
  provider?: string;
  messages: Array<{ role: string; content: string }>;
  signal?: AbortSignal;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
}) {
  return streamByokChat({
    baseUrl: G4F_BASE_URL,
    apiKey: req.apiKey,
    model: req.model,
    provider: req.provider,
    messages: req.messages,
    stream: true,
    signal: req.signal,
    temperature: req.temperature,
    maxTokens: req.maxTokens,
    topP: req.topP,
  });
}

/** Non-streaming G4F chat. */
export function completeG4fChat(req: {
  apiKey: string;
  model: string;
  provider?: string;
  messages: Array<{ role: string; content: string }>;
  signal?: AbortSignal;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
}) {
  return completeByokChat({
    baseUrl: G4F_BASE_URL,
    apiKey: req.apiKey,
    model: req.model,
    provider: req.provider,
    messages: req.messages,
    stream: false,
    signal: req.signal,
    temperature: req.temperature,
    maxTokens: req.maxTokens,
    topP: req.topP,
  });
}

/**
 * Validate a G4F key (PRD §63). Hit the auth-required /v1/models — a 200 means
 * the key is valid; 401/403 means invalid. (Discovery /backend-api/* is
 * public and useless for validation.)
 */
export async function validateG4fKey(
  apiKey: string,
): Promise<{ ok: boolean; error?: string; count?: number }> {
  try {
    const res = await fetch(`${G4F_BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${apiKey.trim()}` },
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "Invalid G4F API key" };
    }
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const json = (await res.json()) as { data?: unknown[] };
    return { ok: true, count: json.data?.length ?? 0 };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function safeFetch(url: string, signal?: AbortSignal): Promise<unknown> {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Helper: derive a capability set for a G4F provider (used by the registry). */
export function g4fCapabilities(p?: G4fProviderInfo): ModelCapabilities {
  return {
    text: true,
    vision: !!p?.vision,
    audio: !!p?.audio,
    video: !!p?.video,
    image: !!p?.image,
    reasoning: false,
    webSearch: false,
    streaming: true,
  };
}

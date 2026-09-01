/**
 * Native model catalog — STATIC registry (no network).
 *
 * The single source of truth for every model the application offers.
 * Derived entirely from the hand-curated `MODELS[]` array in
 * `src/lib/providers/registry.ts` + the provider short-id registry in
 * `src/lib/gateway/ids.ts`. Nothing here fetches, syncs, or discovers —
 * the list is bundled with the application at build time.
 *
 * Every entry maps directly to an implemented native provider adapter
 * (`src/lib/providers/<provider>.ts`), and its `id` is the canonical
 * gateway form `<shortId>/<upstreamId>` accepted by
 * POST /api/v1/chat/completions.
 */

import {
  MODELS,
  PROVIDER_INFO,
  type GatewayModel,
  type ProviderId,
} from "@/lib/providers/registry";
import { getProviderEntry, shortIdFor } from "@/lib/gateway/ids";
import { DELISTED_PROVIDERS } from "@/lib/gateway/adapters/legacy";
import { isDelistedModel } from "@/lib/gateway/delisted";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface NativeModelCapabilities {
  text: boolean;
  reasoning: boolean;
  vision: boolean;
  tools: boolean;
  webSearch: boolean;
  streaming: boolean;
  systemPrompt: boolean;
  multiTurn: boolean;
}

export interface NativeModel {
  /** Canonical gateway id — `<shortId>/<upstreamId>` (e.g. `tb/gpt-5`). */
  id: string;
  /** Display name (legacy registry id, human-friendly). */
  name: string;
  /** Upstream model id sent to the provider. */
  upstreamId: string;
  /** Provider id (e.g. `toolbaz`). */
  providerId: string;
  /** Short provider id (e.g. `tb`). */
  providerShortId: string;
  /** Human provider name (e.g. "Toolbaz"). */
  providerName: string;
  description: string;
  /** Short label for chips/badges. */
  category: "professional" | "sfw" | "unrestricted" | "reasoning";
  capabilities: NativeModelCapabilities;
  /** Approx context window in tokens (0 = unknown). */
  contextWindow: number;
}

export interface NativeProvider {
  id: string;
  shortId: string;
  name: string;
  description: string;
  modelCount: number;
  streamingCount: number;
  toolsCount: number;
  visionCount: number;
  reasoningCount: number;
}

// ─── Mapping ────────────────────────────────────────────────────────────────

function toCapabilities(m: GatewayModel): NativeModelCapabilities {
  return {
    text: true,
    reasoning: m.category === "reasoning",
    vision: m.capabilities.vision,
    tools: m.capabilities.tools,
    webSearch: m.capabilities.webSearch,
    streaming: m.capabilities.streaming,
    systemPrompt: m.capabilities.systemPrompt,
    multiTurn: m.capabilities.multiTurn,
  };
}

function toNativeModel(m: GatewayModel): NativeModel | null {
  let shortId: string;
  try {
    shortId = shortIdFor(m.provider);
  } catch {
    // Provider not registered in the short-id map — skip the entry so the
    // catalog never advertises a model the gateway cannot route.
    return null;
  }
  const entry = getProviderEntry(m.provider);
  return {
    id: `${shortId}/${m.upstream}`,
    name: m.id,
    upstreamId: m.upstream,
    providerId: m.provider,
    providerShortId: shortId,
    providerName: entry?.name ?? PROVIDER_INFO[m.provider]?.name ?? m.provider,
    description: m.description,
    category: m.category,
    capabilities: toCapabilities(m),
    contextWindow: m.contextWindow,
  };
}

/** A model is offered when its provider is not delisted and the specific id
 *  passed the reliability sweep. Delisted entries are hidden (never deleted
 *  from the static registry) — they reappear only via `?all=true` on the API. */
function isOffered(m: NativeModel): boolean {
  if (DELISTED_PROVIDERS.has(m.providerId as never)) return false;
  if (isDelistedModel(m.id)) return false;
  return true;
}

// ─── Static catalog (computed once at module load) ──────────────────────────

const ALL_MODELS: NativeModel[] = MODELS.flatMap((m) => {
  const n = toNativeModel(m);
  return n ? [n] : [];
});

/** Every native model (including delisted/offline ones). */
export const NATIVE_MODELS: readonly NativeModel[] = ALL_MODELS;

/** Models offered in the UI (delisted providers/models filtered out). */
export const OFFERED_MODELS: readonly NativeModel[] = ALL_MODELS.filter(isOffered);

function buildProviders(models: readonly NativeModel[]): NativeProvider[] {
  const byProvider = new Map<ProviderId, NativeModel[]>();
  for (const m of models) {
    const list = byProvider.get(m.providerId as ProviderId);
    if (list) list.push(m);
    else byProvider.set(m.providerId as ProviderId, [m]);
  }
  return Array.from(byProvider.entries())
    .map(([id, list]) => {
      const entry = getProviderEntry(id);
      return {
        id,
        shortId: entry?.shortId ?? id,
        name: entry?.name ?? PROVIDER_INFO[id]?.name ?? id,
        description: PROVIDER_INFO[id]?.description ?? "",
        modelCount: list.length,
        streamingCount: list.filter((m) => m.capabilities.streaming).length,
        toolsCount: list.filter((m) => m.capabilities.tools).length,
        visionCount: list.filter((m) => m.capabilities.vision).length,
        reasoningCount: list.filter((m) => m.capabilities.reasoning).length,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Providers derived from the offered model list. */
export const NATIVE_PROVIDERS: readonly NativeProvider[] = buildProviders(
  OFFERED_MODELS,
);

/** Look up a model by canonical id, short id (`tb/gpt-5`) or legacy id
 *  (`toolbaz-v4.5-fast`). Returns the catalog entry or null. */
export function findNativeModel(id: string): NativeModel | null {
  if (!id) return null;
  // Canonical form first.
  const direct = ALL_MODELS.find((m) => m.id === id);
  if (direct) return direct;
  // Legacy display id.
  const legacy = ALL_MODELS.find((m) => m.name === id);
  if (legacy) return legacy;
  return null;
}

/** Find a model offered in the UI (delisted entries excluded). */
export function findOfferedModel(id: string): NativeModel | null {
  const m = findNativeModel(id);
  return m && isOffered(m) ? m : null;
}

/** The default model for the playground — first streaming reasoning model
 *  with tools, else first streaming model, else first model. */
export const DEFAULT_MODEL_ID: string =
  OFFERED_MODELS.find(
    (m) => m.capabilities.streaming && m.capabilities.tools && m.capabilities.reasoning,
  )?.id ??
  OFFERED_MODELS.find((m) => m.capabilities.streaming)?.id ??
  OFFERED_MODELS[0]?.id ??
  "";

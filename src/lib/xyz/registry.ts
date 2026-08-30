/**
 * Unified model + provider registry (PRD §14, §15, §47, §48).
 *
 * Merges three sources into one normalized view:
 *   - native: derived from the central pricing board (the known native model
 *     ids the FreeAIXYZ gateway already serves).
 *   - g4f:    live discovery from g4f.space/backend-api/v2/* (PUBLIC, cached
 *             globally for 15 min — PRD §47).
 *   - gratisfy: live discovery from api.gratisfy.xyz/v1/models (AUTH-gated,
 *             cached per-user for 15 min when the user has a connected key).
 *
 * Same model from different sources stays independent (PRD §2): a Gemini
 * 2.5 Flash entry exists once per source, never merged.
 */

import { discoverG4f, resolveG4fPricing } from "./g4f";
import { discoverGratisfyModels, resolveGratisfyPricing } from "./gratisfy";
import {
  getSuppliedPricingBoard,
  resolveSuppliedPricing,
} from "./pricing-board";
import { loadBYOKKey } from "./byok";
import { g4fSeedModels, g4fSeedProviders, g4fSeedFetchedAt } from "./seed/g4f-from-seed";
import type {
  ParsedModelId,
  Source,
  UnifiedModel,
  UnifiedProvider,
} from "./types";

const CACHE_TTL_MS = 15 * 60 * 1000; // PRD §47: 10–30 min
let g4fCache: { at: number; models: UnifiedModel[]; providers: UnifiedProvider[] } | null = null;
const gratisfyCache = new Map<string, { at: number; models: UnifiedModel[] }>();

/** Parse a source-aware model id (PRD §18). */
export function parseUnifiedModelId(id: string): ParsedModelId | null {
  const parts = id.split(":");
  if (parts.length < 3) return null;
  const [source, provider, ...rest] = parts;
  if (source !== "native" && source !== "gratisfy" && source !== "g4f") {
    return null;
  }
  return { source, provider, model: rest.join(":"), raw: id };
}

/** Native models derived from the central pricing board. */
export function getNativeModels(): UnifiedModel[] {
  const board = getSuppliedPricingBoard();
  const now = new Date().toISOString();
  return Object.entries(board).map(([id, pricing]) => {
    const [providerSeg, ...rest] = id.split("/");
    return {
      id: `native:${providerSeg}:${rest.join("/")}`,
      displayName: rest.join("/") || id,
      source: "native" as Source,
      provider: providerSeg,
      originalModelId: id,
      capabilities: {
        text: true,
        vision: false,
        audio: false,
        video: false,
        image: false,
        reasoning: false,
        webSearch: false,
        streaming: true,
      },
      streaming: true,
      pricing,
      available: true,
      discoveredAt: now,
      metadata: { boardId: id },
    };
  });
}

/** Native providers (one per pricing-board provider segment). */
export function getNativeProviders(): UnifiedProvider[] {
  const models = getNativeModels();
  const byProvider = new Map<string, UnifiedModel[]>();
  for (const m of models) {
    const arr = byProvider.get(m.provider) ?? [];
    arr.push(m);
    byProvider.set(m.provider, arr);
  }
  const now = new Date().toISOString();
  return Array.from(byProvider.entries()).map(([provider, ms]) => ({
    id: `native:${provider}`,
    name: provider,
    source: "native" as Source,
    requiresApiKey: false,
    supportsModelDiscovery: false,
    supportsStreaming: true,
    capabilities: ["text"],
    models: ms.map((m) => m.id),
    lastDiscoveredAt: now,
  }));
}

/**
 * G4F models + providers. Live discovery is attempted first (cached 15 min —
 * PRD §47). When live discovery returns EMPTY (g4f.space 403s Vercel's egress
 * IPs — verified in prod logs), fall back to the committed seed snapshot so
 * the catalog is never empty (PRD §47-50: serve last-known-good). The
 * `stale` flag marks seed-backed responses.
 */
export async function getG4fModels(): Promise<{
  models: UnifiedModel[];
  providers: UnifiedProvider[];
  stale: boolean;
}> {
  if (g4fCache && Date.now() - g4fCache.at < CACHE_TTL_MS) {
    return { models: g4fCache.models, providers: g4fCache.providers, stale: false };
  }
  const discovered = await discoverG4f();
  if (discovered.models.length > 0 || discovered.providers.length > 0) {
    g4fCache = { at: Date.now(), models: discovered.models, providers: discovered.providers };
    return { models: discovered.models, providers: discovered.providers, stale: false };
  }
  // Live discovery blocked (403 from Vercel egress) → serve the seed.
  void g4fSeedFetchedAt();
  return {
    models: g4fSeedModels(),
    providers: g4fSeedProviders(),
    stale: true,
  };
}

/** Gratisfy models for a specific user (needs their BYOK key; per-user cache). */
export async function getGratisfyModelsForUser(
  userId: string,
): Promise<UnifiedModel[]> {
  const cached = gratisfyCache.get(userId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.models;
  const key = await loadBYOKKey(userId, "gratisfy");
  if (!key) return [];
  const models = await discoverGratisfyModels(key);
  gratisfyCache.set(userId, { at: Date.now(), models });
  return models;
}

/**
 * The full unified model list (PRD §57). Native + G4F are always listed;
 * Gratisfy models are only included when an authenticated userId with a
 * connected key is provided.
 */
export async function getUnifiedModels(
  userId?: string,
): Promise<{ models: UnifiedModel[]; providers: UnifiedProvider[]; stale: boolean }> {
  const native = getNativeModels();
  const nativeProviders = getNativeProviders();
  const g4f = await getG4fModels();
  const gratisfy = userId ? await getGratisfyModelsForUser(userId) : [];
  const gratisfyProviders = buildProvidersFromModels(gratisfy, "gratisfy", true);
  return {
    models: [...native, ...g4f.models, ...gratisfy],
    providers: [...nativeProviders, ...g4f.providers, ...gratisfyProviders],
    // Stale when G4F live discovery was blocked (seed fallback served).
    stale: g4f.stale,
  };
}

function buildProvidersFromModels(
  models: UnifiedModel[],
  source: Source,
  requiresApiKey: boolean,
): UnifiedProvider[] {
  const byProvider = new Map<string, UnifiedModel[]>();
  for (const m of models) {
    const arr = byProvider.get(m.provider) ?? [];
    arr.push(m);
    byProvider.set(m.provider, arr);
  }
  const now = new Date().toISOString();
  return Array.from(byProvider.entries()).map(([provider, ms]) => ({
    id: `${source}:${provider}`,
    name: provider,
    source,
    requiresApiKey,
    supportsModelDiscovery: true,
    supportsStreaming: true,
    capabilities: ms[0]?.capabilities ? Object.keys(ms[0].capabilities).filter((k) => (ms[0].capabilities as Record<string, boolean>)[k]) : [],
    models: ms.map((m) => m.id),
    lastDiscoveredAt: now,
  }));
}

/** Resolve a single model by id (looks across all sources). */
export async function resolveUnifiedModel(
  id: string,
  userId?: string,
): Promise<UnifiedModel | null> {
  const parsed = parseUnifiedModelId(id);
  if (!parsed) {
    // Maybe a bare native id (e.g. "tb/gpt-5") — try the board.
    const pricing = resolveSuppliedPricing(id);
    if (pricing.status !== "not_documented") {
      const [provider, ...rest] = id.split("/");
      return {
        id: `native:${provider}:${rest.join("/")}`,
        displayName: rest.join("/") || id,
        source: "native",
        provider,
        originalModelId: id,
        capabilities: {
          text: true,
          vision: false,
          audio: false,
          video: false,
          image: false,
          reasoning: false,
          webSearch: false,
          streaming: true,
        },
        streaming: true,
        pricing,
        available: true,
        discoveredAt: new Date().toISOString(),
        metadata: { boardId: id },
      };
    }
    return null;
  }
  const { models } = await getUnifiedModels(userId);
  return models.find((m) => m.id === id) ?? null;
}

/** Force a discovery refresh (PRD §48). */
export async function refreshDiscovery(userId?: string): Promise<void> {
  g4fCache = null;
  if (userId) gratisfyCache.delete(userId);
  await getG4fModels();
  if (userId) await getGratisfyModelsForUser(userId);
}

/** Re-export the G4F pricing resolver for the registry consumers. */
export { resolveG4fPricing, resolveGratisfyPricing };

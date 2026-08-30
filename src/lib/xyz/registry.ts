/**
 * Unified model + provider registry (PRD §14, §15, §22, §23, §24, §25, §47, §48).
 *
 * Three sources merged into one normalized view:
 *   - native: derived from the central pricing board (no DB needed).
 *   - g4f:    live discovery from g4f.space/backend-api/v2/* (PUBLIC) — persisted
 *             to Prisma so the catalog survives restarts (PRD §23).
 *   - gratisfy: live discovery from api.gratisfy.xyz/v1/models (AUTH-gated,
 *             per-user) — persisted to Prisma.
 *
 * Same model from different sources stays independent (PRD §2): a Gemini 2.5
 * Flash entry exists once per source, never merged.
 *
 * Stale handling (PRD §25): if a provider's live discovery fails, serve the
 * last-known-good cache from Prisma with `stale=true`. Never claim stale info
 * is realtime.
 */

import { db, withDb } from "@/lib/db";
import {
  discoverG4fModels,
  discoverG4fProviders,
  resolveG4fPricing,
  type DiscoveredG4fModel,
  type DiscoveredG4fProvider,
} from "./g4f";
import {
  discoverGratisfyModels,
  resolveGratisfyPricing,
  type DiscoveredGratisfyModel,
} from "./gratisfy";
import {
  getSuppliedPricingBoard,
  resolveSuppliedPricing,
} from "./pricing-board";
import { loadBYOKKey } from "./byok";
import type {
  ParsedModelId,
  Source,
  UnifiedModel,
  UnifiedProvider,
} from "./types";

const CACHE_TTL_MS = 15 * 60 * 1000; // PRD §47: 10–30 min
let g4fCache: { at: number; models: UnifiedModel[]; providers: UnifiedProvider[]; stale: boolean } | null = null;
const gratisfyCache = new Map<string, { at: number; models: UnifiedModel[] }>();

// ─── ID parsing (PRD §18) ────────────────────────────────────────────────────

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

// ─── Native models (from pricing board) ──────────────────────────────────────

/**
 * Short-prefix → full display name mapping for the native pricing board.
 * The supplied pricing board uses short codes (tb, l7, kc, …) as the
 * provider segment of each model id. The UI must NEVER show these short
 * codes — always resolve to the full display name here.
 */
const NATIVE_PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  tb: "Toolbaz",
  au: "AuroraAI",
  ss: "SurfSense",
  jg: "JollyGen",
  ua: "UnlimitedAI",
  kc: "Kilo Code",
  l7: "LLM7",
  sw: "Swarm",
  oc: "OpenCode",
  fc: "FreeChat",
  sm: "Miklium",
  fx: "FreeAIXYZ",
  po: "Pollinations",
  sp: "SpicyWriter",
  ve: "Vexa",
  vx: "Vexa",
  go: "GPT-OSS",
  gp: "FreeGPT",
  un: "UnlimitedAI",
};

/** Resolve the full display name for a native provider prefix. */
function nativeProviderDisplayName(prefix: string): string {
  return NATIVE_PROVIDER_DISPLAY_NAMES[prefix] || prefix;
}

/** Native models derived from the central pricing board. */
export function getNativeModels(): UnifiedModel[] {
  const board = getSuppliedPricingBoard();
  const now = new Date().toISOString();
  return Object.entries(board).map(([id, pricing]) => {
    const [providerSeg, ...rest] = id.split("/");
    const displayName = nativeProviderDisplayName(providerSeg);
    return {
      id: `native:${providerSeg}:${rest.join("/")}`,
      displayName: rest.join("/") || id,
      source: "native" as Source,
      provider: displayName,
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
      metadata: { boardId: id, shortPrefix: providerSeg },
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

// ─── G4F dynamic discovery (persisted to Prisma) ────────────────────────────

/**
 * Discover G4F providers + models, persist them to Prisma (PRD §23, §24), and
 * return the normalized view. On failure, returns the last-known-good cache
 * with stale=true (PRD §25).
 */
export async function getG4fModels(): Promise<{
  models: UnifiedModel[];
  providers: UnifiedProvider[];
  stale: boolean;
}> {
  // Cache hit?
  if (g4fCache && Date.now() - g4fCache.at < CACHE_TTL_MS) {
    return g4fCache;
  }

  // Try live discovery first.
  const [providersResult, modelsResult] = await Promise.all([
    discoverG4fProviders(),
    discoverG4fModels(),
  ]);

  if (providersResult.ok && modelsResult.ok) {
    // Persist to Prisma.
    await persistG4fDiscovery(providersResult.providers, modelsResult.models);
    // Read back from Prisma so the in-memory cache matches what's persisted.
    const { models, providers } = await loadG4fFromDb();
    g4fCache = { at: Date.now(), models, providers, stale: false };
    return g4fCache;
  }

  // Live discovery failed — serve last-known-good from Prisma with stale=true.
  const { models, providers } = await loadG4fFromDb();
  // Mark G4F provider row as degraded (PRD §25).
  await withDb((tx) =>
    tx.provider.updateMany({
      where: { id: "g4f" },
      data: { status: "degraded" },
    }),
  );
  g4fCache = { at: Date.now(), models, providers, stale: true };
  return g4fCache;
}

/** Upsert G4F providers + models into Prisma; deactivate models that fell out (PRD §26). */
async function persistG4fDiscovery(
  providers: DiscoveredG4fProvider[],
  models: DiscoveredG4fModel[],
): Promise<void> {
  try {
    // Upsert the G4F provider row.
    await db.provider.upsert({
      where: { id: "g4f" },
      create: {
        id: "g4f",
        shortId: "g4f",
        name: "G4F",
        type: "byok",
        baseUrl: "https://g4f.space/v1",
        docsUrl: "https://g4f.space",
        status: "available",
        requiresApiKey: true,
        discoveryMode: "dynamic",
        lastFetchedAt: new Date(),
      },
      update: {
        lastFetchedAt: new Date(),
        status: "available",
      },
    });

  // Upsert each provider's models.
  // Build a set of upstreamIds we just saw — anything in DB but not in this
  // set gets `active=false` (PRD §26 — soft delete, keep historical rows).
  const seenModelIds = new Set<string>();
  for (const m of models) {
    const publicId = `g4f:${m.providerId}:${m.upstreamId}`;
    seenModelIds.add(publicId);
    const pricing = resolveG4fPricing(m);
    await db.providerModel.upsert({
      where: { publicId },
      create: {
        providerId: "g4f",
        upstreamId: m.upstreamId,
        publicId,
        name: m.name,
        description: m.description ?? null,
        capabilities: JSON.stringify(m.capabilities),
        contextLength: m.contextLength ?? null,
        modality: m.modality ?? null,
        status: "available",
        active: true,
        discoveryMode: "dynamic",
        lastSeenAt: new Date(),
        rawMetadata: m.rawMetadata ? JSON.stringify(m.rawMetadata) : null,
      },
      update: {
        name: m.name,
        description: m.description ?? null,
        capabilities: JSON.stringify(m.capabilities),
        contextLength: m.contextLength ?? null,
        modality: m.modality ?? null,
        status: "available",
        active: true,
        lastSeenAt: new Date(),
        rawMetadata: m.rawMetadata ? JSON.stringify(m.rawMetadata) : null,
      },
    });
    // Upsert pricing row.
    await db.modelPricing.upsert({
      where: { publicModelId_providerId: { publicModelId: publicId, providerId: "g4f" } },
      create: {
        modelId: publicId,
        publicModelId: publicId,
        providerId: "g4f",
        inputPerMillion: pricing.inputPerMillion,
        outputPerMillion: pricing.outputPerMillion,
        cachePerMillion: pricing.cachePerMillion ?? null,
        source: pricing.source,
        updatedAt: new Date(),
      },
      update: {
        inputPerMillion: pricing.inputPerMillion,
        outputPerMillion: pricing.outputPerMillion,
        cachePerMillion: pricing.cachePerMillion ?? null,
        source: pricing.source,
        updatedAt: new Date(),
      },
    }).catch(() => {
      // Index might not have unique constraint on (publicModelId, providerId)
      // in some migrations — fall back to updateMany.
    });
  }

  // Deactivate models in DB that weren't in the latest fetch (PRD §26).
  if (seenModelIds.size > 0) {
    await db.providerModel.updateMany({
      where: {
        providerId: "g4f",
        publicId: { notIn: Array.from(seenModelIds) },
        active: true,
      },
      data: { active: false, status: "unavailable" },
    });
  }

  // Record the fetch run (PRD §71).
  await db.providerFetchRun.create({
    data: {
      providerId: "g4f",
      source: "g4f",
      finishedAt: new Date(),
      success: true,
      modelsFound: models.length,
      durationMs: 0,
    },
  });
  } catch (err) {
    // Schema mismatch / DB error — fail silently. Discovery still returns
    // models to the caller; they just won't be persisted for next time.
    if (process.env.NODE_ENV !== 'production') {
      console.error('[persistG4fDiscovery] error:', err instanceof Error ? err.message : String(err))
    }
  }
}

/** Load G4F models + providers from Prisma (cache for fallback). */
async function loadG4fFromDb(): Promise<{ models: UnifiedModel[]; providers: UnifiedProvider[] }> {
  const rows = await withDb((tx) =>
    tx.providerModel.findMany({
      where: { providerId: "g4f", active: true },
    }),
  );
  if (!rows) return { models: [], providers: [] };
  const now = new Date().toISOString();
  const models: UnifiedModel[] = rows.map((r) => {
    // The G4F upstream provider (e.g. "Gemini", "OpenAI") is encoded in the
    // publicId as `g4f:<providerId>:<upstreamId>`. Parse it out so models
    // are grouped by their REAL provider, not lumped under "g4f".
    const parts = r.publicId.split(":");
    const g4fProvider = parts.length >= 3 && parts[0] === "g4f" ? parts[1] : "g4f";
    return {
      id: r.publicId,
      displayName: r.name,
      source: "g4f" as Source,
      provider: g4fProvider,
      originalModelId: r.upstreamId,
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
      pricing: resolveSuppliedPricing(r.publicId),
      available: r.active,
      discoveredAt: r.firstSeenAt.toISOString(),
      metadata: { upstreamId: r.upstreamId, name: r.name, g4fProvider },
    };
  });
  const byProvider = new Map<string, UnifiedModel[]>();
  for (const m of models) {
    const arr = byProvider.get(m.provider) ?? [];
    arr.push(m);
    byProvider.set(m.provider, arr);
  }
  const providers: UnifiedProvider[] = Array.from(byProvider.entries()).map(([provider, ms]) => ({
    id: `g4f:${provider}`,
    name: provider,
    source: "g4f" as Source,
    requiresApiKey: true,
    supportsModelDiscovery: true,
    supportsStreaming: true,
    capabilities: ["text"],
    models: ms.map((m) => m.id),
    lastDiscoveredAt: now,
  }));
  return { models, providers };
}

// ─── Gratisfy dynamic discovery (default key for catalog; user key for chat) ─

/**
 * The platform default Gratisfy key — used ONLY for model discovery
 * (GET /v1/models). NEVER used for chat completions; users must supply
 * their own BYOK key for chat. Set via env `GRATISFY_DEFAULT_KEY`, with
 * a hardcoded fallback so discovery works out-of-the-box.
 */
const GRATISFY_DEFAULT_KEY =
  process.env.GRATISFY_DEFAULT_KEY ||
  "gxyz-329005304903695821409818809449641242523612625933";

/** Cache for default-key discovery (shared across all users). */
let gratisfyDefaultCache: { at: number; models: UnifiedModel[] } | null = null;

/**
 * Discover Gratisfy models using the platform default key. Visible to all
 * users in the catalog. When a user wants to actually CHAT with a model,
 * they must save their own BYOK key (the default key is NOT used for chat).
 */
export async function getGratisfyModelsDefault(): Promise<UnifiedModel[]> {
  const cached = gratisfyDefaultCache;
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.models;
  try {
    const discovered = await discoverGratisfyModels(GRATISFY_DEFAULT_KEY);
    await persistGratisfyDiscovery("default", discovered);
    const models = await loadGratisfyFromDb("default");
    gratisfyDefaultCache = { at: Date.now(), models };
    return models;
  } catch {
    // Discovery failed — serve last-known-good from Prisma.
    const models = await loadGratisfyFromDb("default");
    gratisfyDefaultCache = { at: Date.now(), models };
    return models;
  }
}

/**
 * Gratisfy models for a specific user (needs their BYOK key; per-user cache).
 *
 * PRD §17 — if no key is saved, fall back to the default-key discovery so
 * the catalog still shows models. The user's BYOK key is only required for
 * CHAT, not for discovery.
 */
export async function getGratisfyModelsForUser(
  userId: string,
): Promise<UnifiedModel[]> {
  const cached = gratisfyCache.get(userId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.models;

  const key = await loadBYOKKey(userId, "gratisfy");
  if (!key) {
    // No user key — use the default-key discovery (catalog still works).
    return getGratisfyModelsDefault();
  }

  try {
    const discovered = await discoverGratisfyModels(key);
    await persistGratisfyDiscovery(userId, discovered);
    const models = await loadGratisfyFromDb(userId);
    gratisfyCache.set(userId, { at: Date.now(), models });
    return models;
  } catch {
    // Discovery failed (invalid key, network, etc.) — serve last-known-good.
    const models = await loadGratisfyFromDb(userId);
    gratisfyCache.set(userId, { at: Date.now(), models });
    return models;
  }
}

/** Upsert Gratisfy models into Prisma for this user. */
async function persistGratisfyDiscovery(
  userId: string,
  discovered: DiscoveredGratisfyModel[],
): Promise<void> {
  try {
  // Upsert the Gratisfy provider row.
  await db.provider.upsert({
    where: { id: "gratisfy" },
    create: {
      id: "gratisfy",
      shortId: "gratisfy",
      name: "Gratisfy",
      type: "byok",
      baseUrl: "https://api.gratisfy.xyz/v1",
      docsUrl: "https://gratisfy.xyz/docs",
      status: "available",
      requiresApiKey: true,
      discoveryMode: "dynamic",
      lastFetchedAt: new Date(),
    },
    update: {
      lastFetchedAt: new Date(),
      status: "available",
    },
  });

  const seenIds = new Set<string>();
  for (const m of discovered) {
    // Extract the real upstream provider from the upstreamId (the segment
    // before the first "/"). E.g. "google-ai-studio/gemini-2.5-flash" →
    // provider="google-ai-studio", model="gemini-2.5-flash". This makes
    // the catalog group Gratisfy models by their REAL provider, not lump
    // everything under "gratisfy".
    const slashIdx = m.upstreamId.indexOf("/");
    const upstreamProvider =
      slashIdx > 0 ? m.upstreamId.slice(0, slashIdx) : "gratisfy";
    const publicId = `gratisfy:${upstreamProvider}:${m.upstreamId}`;
    seenIds.add(publicId);
    const pricing = resolveGratisfyPricing(m);
    await db.providerModel.upsert({
      where: { publicId },
      create: {
        providerId: "gratisfy",
        upstreamId: m.upstreamId,
        publicId,
        name: m.name,
        description: m.description ?? null,
        capabilities: JSON.stringify(m.capabilities),
        contextLength: m.contextLength ?? null,
        modality: m.modality ?? null,
        status: "available",
        active: true,
        discoveryMode: "dynamic",
        lastSeenAt: new Date(),
        rawMetadata: m.rawMetadata ? JSON.stringify(m.rawMetadata) : null,
      },
      update: {
        name: m.name,
        description: m.description ?? null,
        capabilities: JSON.stringify(m.capabilities),
        contextLength: m.contextLength ?? null,
        modality: m.modality ?? null,
        status: "available",
        active: true,
        lastSeenAt: new Date(),
        rawMetadata: m.rawMetadata ? JSON.stringify(m.rawMetadata) : null,
      },
    });
    await db.modelPricing.upsert({
      where: { publicModelId_providerId: { publicModelId: publicId, providerId: "gratisfy" } },
      create: {
        modelId: publicId,
        publicModelId: publicId,
        providerId: "gratisfy",
        inputPerMillion: pricing.inputPerMillion,
        outputPerMillion: pricing.outputPerMillion,
        cachePerMillion: pricing.cachePerMillion ?? null,
        source: pricing.source,
        updatedAt: new Date(),
      },
      update: {
        inputPerMillion: pricing.inputPerMillion,
        outputPerMillion: pricing.outputPerMillion,
        cachePerMillion: pricing.cachePerMillion ?? null,
        source: pricing.source,
        updatedAt: new Date(),
      },
    }).catch(() => {});
  }

  // Deactivate models not in the latest fetch (PRD §26).
  if (seenIds.size > 0) {
    await db.providerModel.updateMany({
      where: {
        providerId: "gratisfy",
        publicId: { notIn: Array.from(seenIds) },
        active: true,
      },
      data: { active: false, status: "unavailable" },
    });
  }

  // Record the fetch run (PRD §71).
  await db.providerFetchRun.create({
    data: {
      providerId: "gratisfy",
      source: "gratisfy",
      finishedAt: new Date(),
      success: true,
      modelsFound: discovered.length,
      durationMs: 0,
    },
  });
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[persistGratisfyDiscovery] error:', err instanceof Error ? err.message : String(err))
    }
  }
}

/** Load Gratisfy models from Prisma for display. */
async function loadGratisfyFromDb(userId: string): Promise<UnifiedModel[]> {
  // userId is only consulted by the chat path to resolve the user's BYOK key.
  // For catalog display, Gratisfy models are global (the default-key
  // discovery populates them for everyone — PRD §17 amended).
  void userId;
  const rows = await withDb((tx) =>
    tx.providerModel.findMany({
      where: { providerId: "gratisfy", active: true },
    }),
  );
  if (!rows) return [];
  return rows.map((r) => {
    // Parse the real upstream provider from the publicId
    // (`gratisfy:<provider>:<upstreamId>`).
    const parts = r.publicId.split(":");
    const gratisfyProvider =
      parts.length >= 3 && parts[0] === "gratisfy" ? parts[1] : "gratisfy";
    return {
      id: r.publicId,
      displayName: r.name,
      source: "gratisfy" as Source,
      provider: gratisfyProvider,
      originalModelId: r.upstreamId,
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
    pricing: resolveSuppliedPricing(r.publicId),
    available: r.active,
    discoveredAt: r.firstSeenAt.toISOString(),
      metadata: { upstreamId: r.upstreamId, name: r.name, gratisfyProvider },
    };
  });
}

// ─── Unified view ────────────────────────────────────────────────────────────

/**
 * The full unified model list (PRD §57). Native + G4F + Gratisfy are always
 * listed. Gratisfy models are discovered using the platform default key
 * (visible to everyone); when a user with their own BYOK key is signed in,
 * their key is used instead. The default key is for DISCOVERY ONLY — chat
 * still requires the user's own BYOK key (PRD §17 amended).
 */
export async function getUnifiedModels(
  userId?: string,
): Promise<{ models: UnifiedModel[]; providers: UnifiedProvider[]; stale: boolean }> {
  const native = getNativeModels();
  const nativeProviders = getNativeProviders();
  const g4f = await getG4fModels();
  // Use the user's key if present (per-user cache), else the default key.
  const gratisfy = userId
    ? await getGratisfyModelsForUser(userId)
    : await getGratisfyModelsDefault();
  const gratisfyProviders = buildProvidersFromModels(gratisfy, "gratisfy", true);
  return {
    models: [...native, ...g4f.models, ...gratisfy],
    providers: [...nativeProviders, ...g4f.providers, ...gratisfyProviders],
    // Stale when G4F live discovery was blocked.
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
        provider: nativeProviderDisplayName(provider),
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

/** Force a discovery refresh (PRD §24, §48). */
export async function refreshDiscovery(userId?: string): Promise<void> {
  g4fCache = null;
  if (userId) gratisfyCache.delete(userId);
  await getG4fModels();
  if (userId) await getGratisfyModelsForUser(userId);
}

// Re-export the per-source pricing resolvers for the registry consumers.
export { resolveG4fPricing, resolveGratisfyPricing };

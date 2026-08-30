/**
 * Unified model + provider registry.
 *
 * Three sources merged into one normalized view:
 *   - native:   derived from the central pricing board (in-memory, no fetch).
 *   - g4f:      live discovery from g4f.space/backend-api/v2/* (PUBLIC).
 *   - gratisfy: live discovery from api.gratisfy.xyz/v1/models (AUTH-gated,
 *               per-user BYOK key; default key for catalog when no user key).
 *
 * NO PRISMA PERSISTENCE (per user request — "load on every app open"):
 *   Discovery results are NOT written to or read from a database. Each
 *   `getUnifiedModels` call fetches fresh from upstream and returns the
 *   normalized list directly. A short 30-second in-memory cache prevents
 *   hammering upstream within a single burst of requests; on Vercel
 *   serverless this cache is per-instance and ephemeral anyway, so the
 *   effective behaviour is "fresh on every app open".
 *
 * Same model from different sources stays independent (PRD §2): a Gemini
 * entry exists once per source, never merged.
 */

import {
  discoverG4fModels,
  discoverG4fProviders,
  resolveG4fPricing,
  type DiscoveredG4fModel,
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
  ModelCapabilities,
  ParsedModelId,
  Source,
  UnifiedModel,
  UnifiedProvider,
} from "./types";

// Short cache (30s) — prevents hammering upstream on a burst of requests,
// but always re-fetches on the next app open / page load.
const CACHE_TTL_MS = 30 * 1000;
let g4fCache: { at: number; models: UnifiedModel[]; providers: UnifiedProvider[]; stale: boolean } | null = null;
const gratisfyCache = new Map<string, { at: number; models: UnifiedModel[] }>();

// ─── ID parsing ──────────────────────────────────────────────────────────────

/** Parse a source-aware model id. */
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

// ─── Capabilities helper ────────────────────────────────────────────────────

/** Build a ModelCapabilities object from a discovery capabilities string[] . */
function buildCapabilities(caps: string[] | undefined): ModelCapabilities {
  const set = new Set((caps ?? []).map((c) => c.toLowerCase()));
  return {
    text: true, // all discovered models support text
    vision: set.has("vision"),
    audio: set.has("audio"),
    video: set.has("video"),
    image: set.has("image"),
    reasoning: set.has("reasoning"),
    webSearch: set.has("web_search") || set.has("websearch"),
    streaming: true,
    tools: set.has("tools"),
  };
}

// ─── G4F dynamic discovery (fresh, no persistence) ──────────────────────────

/**
 * Discover G4F providers + models FRESH from upstream and return the
 * normalized view. No database read/write. On failure, returns an empty
 * list with `stale=true` (we have nothing to fall back to — there's no
 * persisted cache any more, by design: "load on every app open").
 */
export async function getG4fModels(): Promise<{
  models: UnifiedModel[];
  providers: UnifiedProvider[];
  stale: boolean;
}> {
  // Short cache hit?
  if (g4fCache && Date.now() - g4fCache.at < CACHE_TTL_MS) {
    return g4fCache;
  }

  const [providersResult, modelsResult] = await Promise.all([
    discoverG4fProviders(),
    discoverG4fModels(),
  ]);

  if (providersResult.ok && modelsResult.ok) {
    const models = buildG4fModels(modelsResult.models);
    const providers = buildProvidersFromModels(models, "g4f", true);
    g4fCache = { at: Date.now(), models, providers, stale: false };
    return g4fCache;
  }

  // Live discovery failed — nothing to serve (no persisted fallback).
  g4fCache = { at: Date.now(), models: [], providers: [], stale: true };
  return g4fCache;
}

/** Build normalized UnifiedModel[] directly from discovered G4F models. */
function buildG4fModels(discovered: DiscoveredG4fModel[]): UnifiedModel[] {
  const now = new Date().toISOString();
  return discovered.map((m) => {
    // providerId is the REAL G4F upstream provider (Gemini, OpenAI, …).
    const publicId = `g4f:${m.providerId}:${m.upstreamId}`;
    return {
      id: publicId,
      displayName: m.name || m.upstreamId,
      source: "g4f" as Source,
      provider: m.providerId,
      originalModelId: m.upstreamId,
      capabilities: buildCapabilities(m.capabilities),
      streaming: true,
      pricing: resolveG4fPricing(m),
      available: true,
      discoveredAt: now,
      metadata: {
        upstreamId: m.upstreamId,
        name: m.name,
        contextLength: m.contextLength,
        modality: m.modality,
      },
    };
  });
}

// ─── Gratisfy dynamic discovery (fresh, no persistence) ─────────────────────

/**
 * The platform default Gratisfy key — used ONLY for model discovery
 * (GET /v1/models). NEVER used for chat completions; users must supply
 * their own BYOK key for chat.
 */
const GRATISFY_DEFAULT_KEY =
  process.env.GRATISFY_DEFAULT_KEY ||
  "gxyz-329005304903695821409818809449641242523612625933";

/** Cache for default-key discovery (shared across anonymous users). */
let gratisfyDefaultCache: { at: number; models: UnifiedModel[] } | null = null;

/**
 * Discover Gratisfy models using the platform default key. Visible to all
 * users in the catalog. When a user wants to actually CHAT, they must save
 * their own BYOK key (the default key is NOT used for chat).
 */
export async function getGratisfyModelsDefault(): Promise<UnifiedModel[]> {
  const cached = gratisfyDefaultCache;
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.models;
  try {
    const discovered = await discoverGratisfyModels(GRATISFY_DEFAULT_KEY);
    const models = buildGratisfyModels(discovered);
    gratisfyDefaultCache = { at: Date.now(), models };
    return models;
  } catch {
    // Discovery failed (upstream down / network) — serve empty (no persisted
    // fallback by design).
    gratisfyDefaultCache = { at: Date.now(), models: [] };
    return [];
  }
}

/**
 * Gratisfy models for a specific user (uses their BYOK key; per-user cache).
 * If no key is saved, fall back to default-key discovery so the catalog
 * still shows Gratisfy models. The user's BYOK key is only required for
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
    const models = buildGratisfyModels(discovered);
    gratisfyCache.set(userId, { at: Date.now(), models });
    return models;
  } catch {
    // User's key invalid / upstream down — fall back to default-key catalog.
    return getGratisfyModelsDefault();
  }
}

/** Build normalized UnifiedModel[] directly from discovered Gratisfy models. */
function buildGratisfyModels(discovered: DiscoveredGratisfyModel[]): UnifiedModel[] {
  const now = new Date().toISOString();
  return discovered.map((m) => {
    // Extract the real upstream provider from the upstreamId (the segment
    // before the first "/"). E.g. "google-ai-studio/gemini-2.5-flash" →
    // provider="google-ai-studio", model="gemini-2.5-flash". This makes
    // the catalog group Gratisfy models by their REAL provider.
    const slashIdx = m.upstreamId.indexOf("/");
    const upstreamProvider =
      slashIdx > 0 ? m.upstreamId.slice(0, slashIdx) : "gratisfy";
    const publicId = `gratisfy:${upstreamProvider}:${m.upstreamId}`;
    return {
      id: publicId,
      displayName: m.name || m.upstreamId,
      source: "gratisfy" as Source,
      provider: upstreamProvider,
      originalModelId: m.upstreamId,
      capabilities: buildCapabilities(m.capabilities),
      streaming: true,
      pricing: resolveGratisfyPricing(m),
      available: true,
      discoveredAt: now,
      metadata: {
        upstreamId: m.upstreamId,
        name: m.name,
        contextLength: m.contextLength,
        modality: m.modality,
      },
    };
  });
}

// ─── Unified view ────────────────────────────────────────────────────────────

/**
 * The full unified model list. Native + G4F + Gratisfy are always listed.
 * Gratisfy models are discovered using the platform default key (visible to
 * everyone); when a signed-in user has their own BYOK key, their key is
 * used instead. The default key is for DISCOVERY ONLY — chat still requires
 * the user's own BYOK key.
 */
export async function getUnifiedModels(
  userId?: string,
): Promise<{ models: UnifiedModel[]; providers: UnifiedProvider[]; stale: boolean }> {
  const native = getNativeModels();
  const nativeProviders = getNativeProviders();
  const g4f = await getG4fModels();
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
    capabilities: ms[0]?.capabilities
      ? Object.keys(ms[0].capabilities).filter(
          (k) => (ms[0].capabilities as Record<string, boolean>)[k],
        )
      : [],
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

/** Force a discovery refresh (clears the short in-memory caches). */
export async function refreshDiscovery(userId?: string): Promise<void> {
  g4fCache = null;
  gratisfyDefaultCache = null;
  if (userId) gratisfyCache.delete(userId);
  await getG4fModels();
  if (userId) await getGratisfyModelsForUser(userId);
  else await getGratisfyModelsDefault();
}

// Re-export the per-source pricing resolvers for the registry consumers.
export { resolveG4fPricing, resolveGratisfyPricing };

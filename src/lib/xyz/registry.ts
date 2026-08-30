/**
 * Unified model + provider registry.
 *
 * Three sources merged into one normalized view:
 *   - native:     derived from the central pricing board (in-memory, no fetch).
 *   - g4f:         live discovery from g4f.space/backend-api/v2/* (PUBLIC).
 *   - gratisfy:    live discovery from api.gratisfy.xyz/v1/models (AUTH-gated,
 *                  per-user BYOK key; default key for catalog when no user key).
 *   - pollinations: live discovery from text.pollinations.ai/models (PUBLIC,
 *                  anonymous — no key required; only the anonymous-tier model
 *                  list is returned, currently just `openai-fast`).
 *
 * NO PRISMA PERSISTENCE + NO IN-MEMORY CACHING (per user request — "remove
 * caching of catalog make it fetch all time on all app open"):
 *   Discovery results are NOT written to or read from a database OR a
 *   cache. Each `getUnifiedModels` call fetches fresh from upstream and
 *   returns the normalized list directly. `CACHE_TTL_MS = 0` means the
 *   cache-check is always falsy, so every call hits the live upstream.
 *   On Vercel serverless this is moot (each cold instance re-fetches
 *   anyway); in `next dev` it means a fresh fetch per request.
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
  discoverPollinationsModels,
  resolvePollinationsPricing,
  type DiscoveredPollinationsModel,
} from "./pollinations";
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

// ─────────────────────────────────────────────────────────────────────────────
// CACHING — DISABLED per user request ("remove caching of catalog make it
// fetch all time on all app open").
//
// The user wants the model catalog to be re-fetched from upstream on EVERY
// app open / page load, never served from a stale in-memory cache. Setting
// CACHE_TTL_MS = 0 means the cache-check `Date.now() - cached.at < 0` is
// never true (a non-negative delta is never < 0), so every call goes
// straight to the upstream fetch. On Vercel serverless this is moot (each
// cold instance re-fetches anyway); in `next dev` it means a fresh fetch
// per request which is exactly what the user asked for.
//
// The cache slots are kept so refreshDiscovery() can still clear them
// (defensive — the slots will always be null/empty in practice).
// ─────────────────────────────────────────────────────────────────────────────
const CACHE_TTL_MS = 0;
let g4fCache: { at: number; models: UnifiedModel[]; providers: UnifiedProvider[]; stale: boolean } | null = null;
const gratisfyCache = new Map<string, { at: number; models: UnifiedModel[] }>();
let pollinationsCache: { at: number; models: UnifiedModel[] } | null = null;

// ─── ID parsing ──────────────────────────────────────────────────────────────

/** Parse a source-aware model id. */
export function parseUnifiedModelId(id: string): ParsedModelId | null {
  const parts = id.split(":");
  if (parts.length < 3) return null;
  const [source, provider, ...rest] = parts;
  if (source !== "native" && source !== "gratisfy" && source !== "g4f" && source !== "pollinations") {
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
  // FIX (2026-08-30): the gateway's PROVIDER_SHORT_IDS in
  // src/lib/gateway/ids.ts maps `sw` → SpicyWriter and `sm` → Swarm.
  // The previous mapping here had `sw: "Swarm"` and `sm: "Miklium"` —
  // both wrong. The catalog displayed SpicyWriter models under the
  // "Swarm" provider name and the playground's NATIVE_NAMES lookup
  // fell through to `provider.toUpperCase()` ("SWARM") because the long
  // name didn't match any short-code key. Now `sw` correctly maps to
  // "SpicyWriter" so the catalog's `native:sw:*` entries surface as
  // SpicyWriter in both the catalog UI and the playground dropdown.
  sw: "SpicyWriter",
  sm: "Swarm",
  oc: "OpenCode",
  fc: "FreeChat",
  mk: "Miklium",
  fx: "FreeAIXYZ",
  po: "Pollinations",
  ve: "Vexa",
  vx: "Vexa",
  go: "GPT-OSS",
  gp: "FreeGPT",
  un: "UnlimitedAI",
  f2: "Free2GPT",
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

/** Build normalized UnifiedModel[] directly from discovered G4F models.
 *
 * DEDUP (PRD §19 / playground React-key fix): the G4F /backend-api/v2/models
 * endpoint occasionally lists the same modelId more than once under the same
 * provider (verified live: LMArena lists "Max" × 2 and "botbot2" × 2;
 * PerplexityApi lists "llama-3-sonar-large-32k-online" × 2). Without dedup,
 * the chat playground's `<SelectItem key={m.id}>` rendered duplicate React
 * keys and threw "Encountered two children with the same key" console errors
 * on every catalog open, lagging the dropdown to a halt. We collapse by the
 * resulting publicId (`g4f:<providerId>:<upstreamId>`) — first occurrence
 * wins, identical duplicates are silently dropped.
 */
function buildG4fModels(discovered: DiscoveredG4fModel[]): UnifiedModel[] {
  const now = new Date().toISOString();
  const seen = new Set<string>();
  const out: UnifiedModel[] = [];
  for (const m of discovered) {
    // providerId is the REAL G4F upstream provider (Gemini, OpenAI, …).
    const publicId = `g4f:${m.providerId}:${m.upstreamId}`;
    if (seen.has(publicId)) continue; // drop upstream-listed duplicate
    seen.add(publicId);
    out.push({
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
    });
  }
  return out;
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

/** Build normalized UnifiedModel[] directly from discovered Gratisfy models.
 *
 * DEDUP (parity with buildG4fModels): collapse by the resulting publicId
 * (`gratisfy:<upstreamProvider>:<upstreamId>`) so a duplicate listing in the
 * upstream /v1/models payload can never produce duplicate React keys in the
 * playground dropdown. First occurrence wins.
 *
 * PROVIDER RESOLUTION (verified live 2026-08-30): the upstream payload now
 * carries a dedicated `provider` field (always present, never "alias") which
 * is the REAL routing slug (e.g. "unorouter", "crax-gpt", "gratisfy"). We
 * read it from the rawMetadata here — it's far more reliable than slicing
 * the upstreamId on "/" because:
 *   (a) ~228 of 486 entries are bare aliases with no "/" in their id;
 *       the previous slicing code fell back to "gratisfy" for all of them,
 *       producing a fake "gratisfy" bucket full of GLM/Qwen/Llama models.
 *   (b) The new normalizeRawModel in the adapter drops bare aliases
 *       entirely, so this function only receives real `<provider>/<id>`
 *       entries — but we still use the `provider` field for correctness.
 *   (c) The platform key only surfaces 3 providers today ({gratisfy: 1,
 *       unorouter: 456, crax-gpt: 29}); the user's BYOK key unlocks the
 *       other ~34 providers documented in the original R1 research.
 */
function buildGratisfyModels(discovered: DiscoveredGratisfyModel[]): UnifiedModel[] {
  const now = new Date().toISOString();
  const seen = new Set<string>();
  const out: UnifiedModel[] = [];
  for (const m of discovered) {
    // Read the dedicated `provider` field from rawMetadata; fall back to
    // the upstreamId prefix (segment before "/") when the field is absent.
    const raw = (m.rawMetadata ?? {}) as Record<string, unknown>;
    const providerFromField =
      typeof raw.provider === "string" && raw.provider.length > 0
        ? raw.provider
        : "";
    const slashIdx = m.upstreamId.indexOf("/");
    const upstreamProvider =
      providerFromField ||
      (slashIdx > 0 ? m.upstreamId.slice(0, slashIdx) : "gratisfy");
    const publicId = `gratisfy:${upstreamProvider}:${m.upstreamId}`;
    if (seen.has(publicId)) continue; // drop upstream-listed duplicate
    seen.add(publicId);
    out.push({
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
    });
  }
  return out;
}

// ─── Pollinations anonymous discovery (fresh, no persistence) ───────────────

/**
 * Discover Pollinations models WITHOUT a token. The
 * `https://text.pollinations.ai/models` endpoint is PUBLIC — it returns
 * the anonymous-tier model list (today just `openai-fast`, the GPT-OSS
 * 20B reasoning model on OVH) with no Authorization header.
 *
 * The user explicitly asked: "add pollinations model fetching api it can
 * too work anonymously so get it too". So this function ALWAYS fetches
 * anonymously — no key, no auth header. (A saved BYOK token is still
 * used for CHAT through the Pollinations native provider; it is not
 * required for catalog discovery.)
 *
 * The returned `UnifiedModel[]` is source="pollinations" so the catalog
 * UI's Pollinations section appears in the playground dropdown (the new
 * rose-coloured palette entry) AND in `/api/v1/models/unified` AND in
 * `/api/v1/models` (the OpenAI-compatible endpoint merges the unified
 * catalog — see /api/v1/models/route.ts).
 */
export async function getPollinationsModelsForCatalog(): Promise<UnifiedModel[]> {
  const cached = pollinationsCache;
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.models;
  try {
    const discovered = await discoverPollinationsModels();
    const models = buildPollinationsModels(discovered);
    pollinationsCache = { at: Date.now(), models };
    return models;
  } catch {
    // Discovery failed (upstream down / network) — serve empty (no
    // persisted fallback by design — fresh fetch on every app open).
    pollinationsCache = { at: Date.now(), models: [] };
    return [];
  }
}

/** Build normalized UnifiedModel[] directly from discovered Pollinations
 *  models.
 *
 * PROVIDER RESOLUTION (new gen.pollinations.ai host, 2026-08-30): every
 * model carries a `brand` field (e.g. "OpenAI", "Qwen", "Anthropic",
 * "Google", "ElevenLabs", "Alibaba") — Pollinations already classifies
 * by provider natively (the user's observation: "tons of models in
 * gratisfy on basis of providers" — same is true on Pollinations).
 *
 * We use `brand` as the provider segment in the unified id
 * (`pollinations:<brand>:<name>`) so the catalog groups Pollinations
 * models by their real brand, not a flat "pollinations" bucket. When
 * `brand` is absent, fall back to "pollinations".
 *
 * DEDUP: collapse by the resulting publicId so the upstream listing the
 * same model twice (e.g. an "openai" canonical + a "gpt-5.4-nano" alias
 * pointing at the same model) can never produce duplicate React keys in
 * the playground dropdown. First occurrence wins.
 */
function buildPollinationsModels(discovered: DiscoveredPollinationsModel[]): UnifiedModel[] {
  const now = new Date().toISOString();
  const seen = new Set<string>();
  const out: UnifiedModel[] = [];
  for (const m of discovered) {
    const brand = m.brand && m.brand.length > 0 ? m.brand : "pollinations";
    const publicId = `pollinations:${brand}:${m.upstreamId}`;
    if (seen.has(publicId)) continue; // drop upstream-listed duplicate
    seen.add(publicId);
    out.push({
      id: publicId,
      displayName: m.name || m.upstreamId,
      source: "pollinations" as Source,
      provider: brand,
      originalModelId: m.upstreamId,
      capabilities: buildCapabilities(m.capabilities),
      streaming: true,
      pricing: resolvePollinationsPricing(m),
      available: true,
      discoveredAt: now,
      metadata: {
        upstreamId: m.upstreamId,
        name: m.name,
        contextLength: m.contextLength,
        modality: m.modality,
      },
    });
  }
  return out;
}

// ─── Unified view ────────────────────────────────────────────────────────────

/**
 * The full unified model list. Native + G4F + Gratisfy + Pollinations are
 * always listed (no caching — fresh fetch on every call per the user's
 * explicit "remove caching of catalog" directive).
 *
 * Gratisfy models are discovered using the platform default key (visible to
 * everyone); when a signed-in user has their own BYOK key, their key is
 * used instead. The default key is for DISCOVERY ONLY — chat still requires
 * the user's own BYOK key.
 *
 * Pollinations models are fetched anonymously (no key required — the
 * `text.pollinations.ai/models` endpoint is public for the anonymous tier).
 * Chat for a Pollinations model goes through the gateway's native
 * Pollinations adapter (`po/<upstreamId>` canonical id) — the playground's
 * chat-completions request carries `pollinations:pollinations:<model>`
 * which the chat route translates to `po/<model>` before delegating to the
 * gateway path.
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
  const pollinations = await getPollinationsModelsForCatalog();
  const pollinationsProviders = buildProvidersFromModels(pollinations, "pollinations", false);
  return {
    models: [...native, ...g4f.models, ...gratisfy, ...pollinations],
    providers: [...nativeProviders, ...g4f.providers, ...gratisfyProviders, ...pollinationsProviders],
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
  pollinationsCache = null;
  if (userId) gratisfyCache.delete(userId);
  await getG4fModels();
  if (userId) await getGratisfyModelsForUser(userId);
  else await getGratisfyModelsDefault();
  await getPollinationsModelsForCatalog();
}

// Re-export the per-source pricing resolvers for the registry consumers.
export { resolveG4fPricing, resolveGratisfyPricing, resolvePollinationsPricing };

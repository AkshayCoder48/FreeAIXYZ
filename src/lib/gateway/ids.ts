/**
 * Provider short-ID registry + canonical model ID helpers (PRD §23, §25, §26).
 *
 * Each provider has a SHORT, STABLE, UNIQUE id used as the canonical prefix
 * for model ids: `<shortId>/<originalUpstreamId>`. IDs are never generated
 * from random strings or derived from model names — they are declared here
 * (PRD §26).
 */

export interface ProviderShortIdEntry {
  /** Full provider id (matches adapter `id`). */
  id: string;
  /** Short stable id (2-4 chars). */
  shortId: string;
  /** Human provider name. */
  name: string;
  /** Base URL where available. */
  baseUrl?: string;
}

/**
 * The authoritative provider short-id registry (PRD §26).
 * When adding a provider, add ONE entry here and create the adapter —
 * do NOT touch the chat UI, model selector, API router, or schema (PRD §164).
 */
export const PROVIDER_SHORT_IDS: readonly ProviderShortIdEntry[] = [
  { id: "toolbaz", shortId: "tb", name: "Toolbaz", baseUrl: "https://api.toolbaz.com" },
  { id: "auroraai", shortId: "au", name: "AuroraAI", baseUrl: "https://www.nsfwlover.com" },
  { id: "surfsense", shortId: "ss", name: "SurfSense", baseUrl: "https://api.surfsense.com" },
  { id: "jollygen", shortId: "jg", name: "JollyGen", baseUrl: "https://api.jollygenapi.space" },
  { id: "unlimitedai", shortId: "ua", name: "UnlimitedAI", baseUrl: "https://unlimitedai.chat" },
  { id: "kilocode", shortId: "kc", name: "Kilo Code", baseUrl: "https://api.kilo.ai" },
  { id: "llm7", shortId: "l7", name: "LLM7", baseUrl: "https://api.llm7.io" },
  { id: "spicywriter", shortId: "sw", name: "SpicyWriter", baseUrl: "https://spicywriter.com" },
  { id: "freegpt", shortId: "fg", name: "FreeGPT", baseUrl: "https://freegpt.tech" },
  { id: "opencode", shortId: "oc", name: "OpenCode", baseUrl: "https://api.opencode.ai" },
  { id: "freechat", shortId: "fc", name: "FreeChat", baseUrl: "https://llmproxy.org" },
  { id: "miklium", shortId: "mk", name: "Miklium", baseUrl: "https://api.miklium.com" },
  { id: "swarm", shortId: "sm", name: "Swarm", baseUrl: "https://g4f-dev.workers.dev" },
  { id: "freeaixyz", shortId: "fx", name: "FreeAIXYZ", baseUrl: "https://api.freeaixyz.com" },
  { id: "gptoss", shortId: "go", name: "GPT-OSS", baseUrl: "https://broken-water-d859.junioralive.workers.dev" },
  { id: "vexa", shortId: "vx", name: "Vexa", baseUrl: "https://vexa-ai.pages.dev" },
  // Task 7 (v4): new free providers discovered via web research + live-tested.
  // `un` — UncloseAI (hermes.ai.unturf.com): pure OpenAI-compatible, no auth,
  //        no signup. Single community GPU serving Qwen 3.6 27B (int4).
  // `f2` — Free2GPT (chat4.free2gpt.com): signed-request API (sha256 with
  //        empty secret), plain-text response. No auth, no signup.
  { id: "uncloseai", shortId: "un", name: "UncloseAI", baseUrl: "https://hermes.ai.unturf.com" },
  { id: "free2gpt", shortId: "f2", name: "Free2GPT", baseUrl: "https://chat4.free2gpt.com" },
  // Image providers (no chat adapter but used for image model catalog).
  { id: "jollygen-image", shortId: "ji", name: "JollyGen Image", baseUrl: "https://api.jollygenapi.space" },
  { id: "aianime", shortId: "ai", name: "AIAnime", baseUrl: "https://api.aianime.io" },
];

const SHORT_ID_BY_FULL = new Map<string, ProviderShortIdEntry>(
  PROVIDER_SHORT_IDS.map((e) => [e.id, e]),
);
const FULL_ID_BY_SHORT = new Map<string, ProviderShortIdEntry>(
  PROVIDER_SHORT_IDS.map((e) => [e.shortId, e]),
);

/** Resolve a full provider id → its short id entry. */
export function getProviderEntry(id: string): ProviderShortIdEntry | undefined {
  return SHORT_ID_BY_FULL.get(id);
}

/** Resolve a short id → its entry. */
export function getByShortId(shortId: string): ProviderShortIdEntry | undefined {
  return FULL_ID_BY_SHORT.get(shortId);
}

/** Get the short id for a full provider id (throws if unregistered — PRD §26). */
export function shortIdFor(id: string): string {
  const entry = SHORT_ID_BY_FULL.get(id);
  if (!entry) {
    throw new Error(
      `Provider "${id}" has no registered short id. Add it to PROVIDER_SHORT_IDS in src/lib/gateway/ids.ts (PRD §26).`,
    );
  }
  return entry.shortId;
}

/** Build the canonical public model id (PRD §25). */
export function canonicalModelId(providerId: string, upstreamId: string): string {
  return `${shortIdFor(providerId)}/${upstreamId}`;
}

/**
 * Parse a canonical model id into { providerId, upstreamId } (PRD §66, §99).
 * Returns null if the prefix namespace is unknown (PRD §99 → invalid_model_namespace).
 */
export function parseCanonicalModelId(
  publicId: string,
): { providerId: string; upstreamId: string } | null {
  const slashIdx = publicId.indexOf("/");
  if (slashIdx <= 0) return null;
  const short = publicId.slice(0, slashIdx);
  const upstream = publicId.slice(slashIdx + 1);
  const entry = FULL_ID_BY_SHORT.get(short);
  if (!entry) return null;
  return { providerId: entry.id, upstreamId: upstream };
}

/** Return all registered providers (for the registry UI). */
export function listProviderEntries(): ProviderShortIdEntry[] {
  return [...PROVIDER_SHORT_IDS];
}

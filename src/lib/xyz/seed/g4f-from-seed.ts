/**
 * G4F seed normalizer — serves the cached G4F catalog when live discovery
 * from Vercel's egress is blocked (g4f.space returns HTTP 403 to Vercel IPs;
 * verified in prod logs). PRD §47-50: when discovery fails, serve last-known-
 * good rather than dropping all models.
 *
 * The seed is fetched from a non-Vercel egress (the sandbox, where g4f.space
 * is reachable) and committed; refresh it periodically by re-running the
 * fetch from outside Vercel.
 */

import { resolveG4fPricing } from "../g4f";
import type { Source, UnifiedModel, UnifiedProvider } from "../types";
// JSON import — Next.js/TS resolve this at build time.
import seedData from "./g4f-seed.json";

interface SeedProvider {
  name: string;
  label?: string;
  vision?: boolean;
  image?: boolean;
  audio?: boolean;
  video?: boolean;
  auth?: boolean;
  login?: boolean;
  live?: boolean;
}

const seed = seedData as {
  fetchedAt: string;
  models: Record<string, string[]>;
  providers: SeedProvider[];
};

export function g4fSeedModels(): UnifiedModel[] {
  const now = new Date().toISOString();
  const out: UnifiedModel[] = [];
  const providerInfo = new Map(seed.providers.map((p) => [p.name, p]));
  for (const [provider, modelIds] of Object.entries(seed.models)) {
    const p = providerInfo.get(provider);
    for (const m of modelIds) {
      out.push({
        id: `g4f:${provider}:${m}`,
        displayName: m,
        source: "g4f" as Source,
        provider,
        originalModelId: m,
        capabilities: {
          text: true,
          vision: !!p?.vision,
          audio: !!p?.audio,
          video: !!p?.video,
          image: !!p?.image,
          reasoning: false,
          webSearch: false,
          streaming: true,
        },
        streaming: true,
        pricing: resolveG4fPricing(m),
        available: true,
        discoveredAt: now,
        metadata: { providerInfo: p ?? null, seeded: true, seedFetchedAt: seed.fetchedAt },
      });
    }
  }
  return out;
}

export function g4fSeedProviders(): UnifiedProvider[] {
  const now = new Date().toISOString();
  const modelsByProvider = new Map<string, string[]>();
  for (const [prov, ids] of Object.entries(seed.models)) {
    modelsByProvider.set(prov, ids.map((m) => `g4f:${prov}:${m}`));
  }
  return seed.providers.map((p) => ({
    id: `g4f:${p.name}`,
    name: p.label ?? p.name,
    source: "g4f" as Source,
    requiresApiKey: !!(p.auth || p.login),
    supportsModelDiscovery: true,
    supportsStreaming: true,
    capabilities: [
      ...(p.vision ? ["vision"] : []),
      ...(p.image ? ["image"] : []),
      ...(p.audio ? ["audio"] : []),
      ...(p.video ? ["video"] : []),
      ...((p.auth || p.login) ? ["auth"] : []),
    ],
    models: modelsByProvider.get(p.name) ?? [],
    lastDiscoveredAt: now,
  }));
}

export function g4fSeedFetchedAt(): string {
  return seed.fetchedAt;
}

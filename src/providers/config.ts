/**
 * Per-provider sync configuration (Task 11-backend, PRD §18, §29, §31).
 *
 * One entry per provider. The `pricingMode` drives the default free
 * classification; per-provider `free.ts` may override.
 */

import type { ProviderConfig } from "./types";

/**
 * Default per-provider timeout (15s — PRD §29). Individual providers may
 * override via `timeoutMs` below (e.g. slower sites like SpicyWriter).
 */
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * The authoritative per-provider config (PRD §18, §29).
 * PricingMode legend:
 *   - entirely_free → all discovered models free (PRD §16)
 *   - pattern → free determined by provider-specific regex (PRD §18)
 *   - hybrid → mostly free, some require API key (LLM7)
 *   - api → all paid (none here, kept for completeness)
 */
export const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  pollinations: {
    id: "pollinations",
    pricingMode: "entirely_free",
    timeoutMs: 8_000,
    enabled: true,
    maxModels: 50,
  },
  kilocode: {
    id: "kilocode",
    pricingMode: "pattern",
    timeoutMs: 12_000,
    enabled: true,
    freePatterns: [/:free$/i, /^free-/i, /free$/i],
    maxModels: 30,
  },
  llm7: {
    id: "llm7",
    pricingMode: "hybrid",
    timeoutMs: 10_000,
    enabled: true,
    maxModels: 60,
  },
  opencode: {
    id: "opencode",
    pricingMode: "pattern",
    timeoutMs: 12_000,
    enabled: true,
    freePatterns: [/-free$/i, /_free$/i, /free$/i],
    maxModels: 64,
  },
  swarm: {
    id: "swarm",
    pricingMode: "entirely_free",
    timeoutMs: 12_000,
    enabled: true,
  },
  spicywriter: {
    id: "spicywriter",
    pricingMode: "pattern",
    timeoutMs: 15_000,
    enabled: true,
    // Spicy LITE tier is free for anonymous BASIC users (verified via live
    // /api/llm/models response — see src/providers/spicywriter/discover.ts).
    // free.ts classifies based on tierType=="LITE" not on naming.
    maxModels: 60,
  },
  vexa: {
    id: "vexa",
    pricingMode: "entirely_free",
    timeoutMs: 8_000,
    enabled: true,
  },
  gptoss: {
    id: "gptoss",
    pricingMode: "entirely_free",
    timeoutMs: 8_000,
    enabled: true,
  },
  auroraai: {
    id: "auroraai",
    pricingMode: "entirely_free",
    timeoutMs: 8_000,
    enabled: true,
  },
  surfsense: {
    id: "surfsense",
    pricingMode: "entirely_free",
    timeoutMs: 8_000,
    enabled: true,
  },
  jollygen: {
    id: "jollygen",
    pricingMode: "entirely_free",
    timeoutMs: 8_000,
    enabled: true,
  },
  unlimitedai: {
    id: "unlimitedai",
    pricingMode: "entirely_free",
    timeoutMs: 8_000,
    enabled: true,
  },
  freechat: {
    id: "freechat",
    pricingMode: "entirely_free",
    timeoutMs: 8_000,
    enabled: true,
  },
  miklium: {
    id: "miklium",
    pricingMode: "entirely_free",
    timeoutMs: 8_000,
    enabled: true,
  },
  freeaixyz: {
    id: "freeaixyz",
    pricingMode: "entirely_free",
    timeoutMs: 12_000,
    enabled: true,
  },
  freegpt: {
    id: "freegpt",
    pricingMode: "pattern",
    timeoutMs: 12_000,
    // DELISTED 2026-08-26: the FreeGPT.tech challenge endpoint now returns
    // HTML (Cloudflare page) instead of JSON, so the WASM signer integration
    // can't get a valid challenge. The discover() falls back to MODELS[]
    // hard-coded ids, but the chat proxy can no longer actually call them
    // (0% success rate in the 3,610-request reliability sweep). Disable the
    // sync engine for freegpt so it doesn't repopulate the catalog with
    // broken entries that override the legacy `delisted` marker.
    enabled: false,
    freePatterns: [/(^|[-:_])free$/i, /-free-/i, /^free-/i, /free$/i],
    maxModels: 80,
  },
  toolbaz: {
    id: "toolbaz",
    pricingMode: "entirely_free",
    timeoutMs: 8_000,
    enabled: true,
  },
};

/** Resolve a provider config (falls back to a sane disabled default). */
export function getProviderConfig(providerId: string): ProviderConfig {
  return (
    PROVIDER_CONFIGS[providerId] ?? {
      id: providerId,
      pricingMode: "pattern",
      timeoutMs: DEFAULT_TIMEOUT_MS,
      enabled: false,
    }
  );
}

/**
 * Central Pricing Board (PRD §23, §24, §25, §26, §29, §30).
 *
 * ONE authoritative registry. Every model resolves its pricing from here — no
 * provider adapter may independently calculate XYZ. The supplied baseline
 * (PRD §24) is embedded verbatim; manual/admin overrides live in OnyxBase and
 * take priority (PRD §29).
 *
 * Resolution priority (PRD §29):
 *   1. Manual / admin override (OnyxBase: freeaixyz:pricing:override:<id>)
 *   2. Official provider pricing (set by adapters that fetch real pricing)
 *   3. Verified pricing metadata
 *   4. Supplied pricing board (the baseline below)
 *   5. not_documented
 *
 * "$0" ≠ "not_documented" (PRD §26):
 *   - $0 with status "free"        → explicitly free / open
 *   - null with status "not_documented" → cannot establish a price
 */

import type {
  ModelPricing,
  PricingVersion,
  PricingStatus,
} from "./types";

/**
 * The product-owner-supplied baseline (PRD §24). USD per 1M tokens.
 * 0 = explicitly free/open/no published charge (per the supplied comment).
 */
type SuppliedPrice = {
  in: number;
  out: number;
  cache?: number;
};

const SUPPLIED_PRICING: Record<string, SuppliedPrice> = {
  "tb/gpt-5": { in: 1.25, out: 10.0, cache: 0.125 },
  "tb/gpt-5.2": { in: 1.75, out: 14.0, cache: 0.175 },
  "tb/gpt-4o-latest": { in: 2.5, out: 10.0 },
  "tb/gpt-oss-120b": { in: 0.0, out: 0.0 },
  "tb/o3-mini": { in: 1.1, out: 4.4 },
  "tb/claude-sonnet-4": { in: 3.0, out: 15.0, cache: 0.3 },
  "tb/gemini-2.5-flash": { in: 0.3, out: 2.5 },
  "tb/gemini-2.5-pro": { in: 1.25, out: 10.0, cache: 0.125 },
  "tb/gemini-3-flash": { in: 0.5, out: 3.0, cache: 0.05 },
  "tb/gemini-3.1-flash-lite": { in: 0.25, out: 1.5, cache: 0.02 },
  "tb/gemini-3.5-flash": { in: 1.5, out: 9.0, cache: 0.15 },
  "tb/gemini-3.6-flash": { in: 1.5, out: 7.5, cache: 0.15 },
  "tb/codestral-latest": { in: 0.3, out: 0.9 },
  "tb/deepseek-r1": { in: 0.55, out: 2.19 },
  "tb/deepseek-v3": { in: 0.24, out: 0.9, cache: 0.135 },
  "tb/deepseek-v3.1": { in: 0.25, out: 0.95, cache: 0.13 },
  "tb/grok-4-fast": { in: 0.2, out: 0.5 },
  "tb/toolbaz-v4.5-fast": { in: 0.0, out: 0.0 },
  "tb/toolbaz_v4": { in: 0.0, out: 0.0 },
  "tb/L3-70B-Euryale-v2.1": { in: 0.0, out: 0.0 },
  "tb/midnight-rose": { in: 0.0, out: 0.0 },
  "au/llama3-8b": { in: 0.0, out: 0.0 },
  "ss/gpt-5.4-mini-no-login": { in: 0.75, out: 4.5 },
  "ss/gpt-o4-mini-no-login": { in: 1.1, out: 4.4 },
  "jg/jollygen": { in: 0.0, out: 0.0 },
  "ua/chat-model-reasoning": { in: 0.0, out: 0.0 },
  "ua/chat-model-reasoning-with-search": { in: 0.0, out: 0.0 },
  "kc/tencent/hy3:free": { in: 0.15, out: 0.59 },
  "kc/nvidia/nemotron-3-ultra-550b-a55b:free": { in: 0.5, out: 2.2, cache: 0.1 },
  "kc/nvidia/nemotron-3-super-120b-a12b:free": { in: 0.085, out: 0.4 },
  "kc/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free": { in: 0.0, out: 0.0 },
  "kc/poolside/laguna-s-2.1:free": { in: 0.0, out: 0.0 },
  "kc/cohere/north-mini-code:free": { in: 0.0, out: 0.0 },
  "kc/kilo-auto/free": { in: 0.0, out: 0.0 },
  "kc/kilo-auto/small": { in: 0.0, out: 0.0 },
  "kc/stepfun/step-3.7-flash:free": { in: 0.2, out: 1.15 },
  "l7/minimax-m2.7": { in: 0.3, out: 1.2, cache: 0.06 },
  "l7/minimax-m3": { in: 0.3, out: 1.2, cache: 0.06 },
  "l7/deepseek-v4-flash": { in: 0.14, out: 0.28 },
  "l7/glm-5.3-flash": { in: 0.0, out: 0.0 },
  // ─── SpicyWriter (sw prefix per the gateway's PROVIDER_SHORT_IDS) ────────
  // FIX (2026-08-30): the previous entries used `sw/Nemo` and `sw/Lunaris`.
  // `sw` is the gateway's shortId for SpicyWriter (NOT Swarm — that's `sm`).
  // The gateway's spicywriter adapter (src/lib/providers/spicywriter.ts)
  // accepts two upstream model names: "Ling 2.6 Flash" and "Nemo". The
  // `Lunaris` upstream belongs to AuroraAI (sao10k/l3-lunaris-8b) — it was
  // an error. Replaced `sw/Lunaris` with `sw/Ling 2.6 Flash` (the gateway
  // catalog's canonical id for the spicywriter Ling model — the gateway
  // uses `<shortId>/<upstream>` so spaces in the upstream name are fine).
  //
  // NOTE: `sw/Ling 2.6 Flash` is on the gateway's DELISTED_MODELS list
  // (upstream returns empty response) — but it still surfaces in the
  // catalog (just with a degraded status). `sw/Nemo` is fully available.
  "sw/Nemo": { in: 0.0, out: 0.0 },
  "sw/Ling 2.6 Flash": { in: 0.0, out: 0.0 },
  "oc/mimo-v2.5-free": { in: 0.0, out: 0.0 },
  "oc/nemotron-3-ultra-free": { in: 0.5, out: 2.2, cache: 0.1 },
  "oc/laguna-s-2.1-free": { in: 0.0, out: 0.0 },
  "oc/hy3-free": { in: 0.15, out: 0.59 },
  "oc/ling-3.0-flash-fin-free": { in: 0.0, out: 0.0 },
  "fc/v3": { in: 0.0, out: 0.0 },
  "sm/Qwen3.5-9B-Q4_K_M.gguf": { in: 0.0, out: 0.0 },
  "fx/chatgpt": { in: 0.0, out: 0.0 },
  "fx/gemini": { in: 0.0, out: 0.0 },
  "fx/deepseek": { in: 0.0, out: 0.0 },
  "fx/claude": { in: 0.0, out: 0.0 },
  "fx/grok": { in: 0.0, out: 0.0 },
  "fx/perplexity": { in: 0.0, out: 0.0 },
  "fx/meta": { in: 0.0, out: 0.0 },
  "fx/qwen": { in: 0.0, out: 0.0 },
  "fx/chatgpt-search": { in: 0.0, out: 0.0 },
  "fx/gemini-search": { in: 0.0, out: 0.0 },
  "fx/deepseek-search": { in: 0.0, out: 0.0 },
  "fx/claude-search": { in: 0.0, out: 0.0 },
  "fx/grok-search": { in: 0.0, out: 0.0 },
  "fx/perplexity-search": { in: 0.0, out: 0.0 },
  "fx/meta-search": { in: 0.0, out: 0.0 },
  "fx/qwen-search": { in: 0.0, out: 0.0 },
  "go/gpt-oss-120b": { in: 0.0, out: 0.0 },
  "vx/vexa": { in: 0.0, out: 0.0 },
  "un/Lorbus/Qwen3.6-27B-int4-AutoRound": { in: 0.0, out: 0.0 },
  "kc/meituan/longcat-2.0-free": { in: 0.0, out: 0.0 },
  "kc/inclusionai/ling-3.0-flash-fin:free": { in: 0.0, out: 0.0 },
  "kc/dots-studio/dots-3-note-preview:free": { in: 0.0, out: 0.0 },
  "sm/koboldcpp/Gemma4-12B-lv-16x16-7250-1_69-Q4_K_M": { in: 0.0, out: 0.0 },
  "sm/koboldcpp/magnum-v4-12b-Q4_K_M": { in: 0.0, out: 0.0 },
  "sm/koboldcpp/TheDrummer_Cydonia-24B-v4.3-Q4_K_M": { in: 0.0, out: 0.0 },
  "sm/koboldcpp/L3-8B-Stheno-v3.2-Q8_0": { in: 0.0, out: 0.0 },
};

/**
 * XYZ → USD conversion constant (PRD §32). ONE place to change it.
 * Default 1.0 → 1 XYZ ≈ $1 of model usage at market pricing. Tune via env.
 */
export const XYZ_USD_MULTIPLIER = Number(
  process.env.XYZ_USD_MULTIPLIER ?? "1",
);

/** Reference request for the "responses per XYZ" estimate (PRD §33, §34). */
export const REFERENCE_REQUEST = {
  inputTokens: Number(process.env.REFERENCE_INPUT_TOKENS ?? "1200"),
  outputTokens: Number(process.env.REFERENCE_OUTPUT_TOKENS ?? "800"),
};

/**
 * Pricing board version. Bumped when the baseline or any override changes
 * (PRD §30). Historical usage records store the version used so past usage
 * remains correct after pricing changes.
 */
export const PRICING_BOARD_VERSION = 1;

export function getPricingVersion(): PricingVersion {
  return {
    version: PRICING_BOARD_VERSION,
    updatedAt: new Date().toISOString(),
    source: "pricing-board",
  };
}

/**
 * Resolve pricing for a model id (PRD §29). Resolution order:
 *   1. supplied baseline (above)
 *   2. not_documented
 *
 * Manual/admin overrides + provider-fetched documented pricing are layered on
 * by the OnyxBase-backed resolver in `pricing-resolver.ts` (which calls this
 * function as the fallback). Kept separate so the pure baseline is testable
 * without OnyxBase.
 */
export function resolveSuppliedPricing(modelId: string): ModelPricing {
  const entry = SUPPLIED_PRICING[modelId];
  if (entry) {
    const isFree =
      entry.in === 0 && entry.out === 0 && (entry.cache ?? 0) === 0;
    return {
      inputPerMillion: entry.in,
      outputPerMillion: entry.out,
      cachePerMillion: entry.cache ?? null,
      currency: "USD",
      status: isFree ? ("free" as PricingStatus) : "supplied",
      source: "pricing-board",
      verifiedAt: new Date().toISOString(),
    };
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

/** The full supplied baseline (for the pricing-board UI + API). */
export function getSuppliedPricingBoard(): Record<string, ModelPricing> {
  const out: Record<string, ModelPricing> = {};
  for (const [id, entry] of Object.entries(SUPPLIED_PRICING)) {
    const isFree =
      entry.in === 0 && entry.out === 0 && (entry.cache ?? 0) === 0;
    out[id] = {
      inputPerMillion: entry.in,
      outputPerMillion: entry.out,
      cachePerMillion: entry.cache ?? null,
      currency: "USD",
      status: isFree ? "free" : "supplied",
      source: "pricing-board",
      verifiedAt: new Date().toISOString(),
    };
  }
  return out;
}

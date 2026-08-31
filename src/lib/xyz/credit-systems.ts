/**
 * Credit-systems reference (user directive: "there are more credit system
 * from different gratisfy providers calculated them on basis of 1xyz=?
 * Okay and list them").
 *
 * Verified live against `https://gratisfy.xyz/api/models/all` (2026-08-31):
 * 6 distinct currency/credit systems appear across the 2108-model catalog.
 * This module is the single source of truth for their XYZ conversions.
 *
 * Conversions:
 *   1 XYZ = 1 USD            (XYZ_USD_MULTIPLIER = 1, default)
 *   1 XYZ = 1 pollen         (POLLEN_XYZ_PEG = 1, user directive)
 *   1 XYZ = ~90,909 neurons  (1 neuron ≈ $0.000011, derived from
 *                              cloudflare pricing: $0.350/M = 31818 neurons/M)
 *   credits (electronhub)   — free-tier rate-limit budget, NOT monetary
 *   credits (voidai)        — fixed per-call, no published XYZ rate
 *   tokens/day               — free-tier budget, NOT a price
 */

export interface CreditSystem {
  /** Currency/credit unit slug. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Unit suffix used in pricing strings (e.g. "/M", "/img"). */
  unitSuffixes: string[];
  /** Gratisfy providers (routing slugs) that use this currency. */
  providers: string[];
  /** Example model ids carrying this currency. */
  exampleModels: string[];
  /** "1 XYZ = ?" conversion in this currency (null when not monetary). */
  xyzConversion: string | null;
  /** Per-unit USD rate (null when not monetary / not derivable). */
  usdPerUnit: number | null;
  /** Whether the gateway bills this currency in XYZ. */
  billsInXyz: boolean;
  /** Short description. */
  description: string;
}

/** The full list of credit systems the gateway recognises. */
export const CREDIT_SYSTEMS: CreditSystem[] = [
  {
    id: "usd",
    name: "USD ($)",
    unitSuffixes: ["/M", "/img", "/audio minute", "/1k characters", "/inference request", "/minute", "/step"],
    providers: ["cloudflare", "mnn", "vercel", "navy", "voidai"],
    exampleModels: [
      "gratisfy:cloudflare:@cf/meta/llama-3.2-3b-instruct ($0.051/$0.335 per M)",
      "gratisfy:cloudflare:@cf/myshell-ai/melotts ($0.000205/audio minute)",
      "gratisfy:mnn:gpt-4o-transcribe (numeric USD)",
    ],
    xyzConversion: "1 XYZ = 1 USD",
    usdPerUnit: 1,
    billsInXyz: true,
    description: "Standard USD per-million-token (or per-image / per-minute) pricing. The gateway multiplies by XYZ_USD_MULTIPLIER (default 1) to bill in XYZ.",
  },
  {
    id: "pollen",
    name: "Pollen (Pollinations internal token)",
    unitSuffixes: ["/M", "/img", "/sec", "/hour"],
    providers: ["pollinations"],
    exampleModels: [
      "gratisfy:pollinations:tomdacatto/claude-opus-5 (5 pollen/M in, 25 pollen/M out)",
      "gratisfy:pollinations:Catniti/agnes-image-2.0-flash (0.06 pollen/img)",
      "gratisfy:pollinations:nova-reel (0.08 pollen/sec)",
    ],
    xyzConversion: "1 XYZ = 1 pollen (1:1 peg)",
    usdPerUnit: null,
    billsInXyz: true,
    description: "Pollinations's internal currency, NOT USD (1 pollen ≠ $1). The gateway pegs 1 pollen = 1 XYZ (POLLEN_XYZ_PEG = 1). Pollen-priced models require a connected Pollinations wallet.",
  },
  {
    id: "neurons",
    name: "Neurons (Cloudflare Workers AI)",
    unitSuffixes: ["/M (display)", "/day free (free tier)"],
    providers: ["cloudflare"],
    exampleModels: [
      "gratisfy:cloudflare:@cf/openai/gpt-oss-120b ($0.350/M = 31818 neurons/M)",
      "gratisfy:cloudflare:@cf/baai/bge-m3 ($0.012/M = 1075 neurons/M)",
    ],
    xyzConversion: "1 XYZ ≈ 90,909 neurons (1 neuron ≈ $0.000011)",
    usdPerUnit: 0.000011,
    billsInXyz: true,
    description: "Cloudflare Workers AI internal currency. Neurons appear ONLY in display fields (pricing.inputDisplay); the actual pricing.input/output is always USD for cloudflare. The gateway bills cloudflare models in USD→XYZ. 10,000 neurons/day free tier ≈ $0.11/day.",
  },
  {
    id: "credits-request",
    name: "Credits per request (Electron Hub)",
    unitSuffixes: ["/request"],
    providers: ["electronhub"],
    exampleModels: [
      "gratisfy:electronhub:gpt-oss-20b:free (1 credit/request)",
      "gratisfy:electronhub:claude-sonnet-4-5:free (5 credits/request)",
      "gratisfy:electronhub:glm-5:free (3 credits/request)",
    ],
    xyzConversion: null,
    usdPerUnit: null,
    billsInXyz: false,
    description: "Electron Hub's free-tier rate-limit credits. All :free-suffix models. NO published USD-per-credit rate — these are request-budget quotas, not monetary prices. The gateway treats them as free (platform XYZ charge = 0; the upstream bills the user's own key).",
  },
  {
    id: "credits-fixed",
    name: "Credits fixed per call (VoidAI)",
    unitSuffixes: ["fixed per call"],
    providers: ["voidai"],
    exampleModels: [
      "gratisfy:voidai:tts-1 (75 credits)",
      "gratisfy:voidai:tts-1-hd (150 credits)",
      "gratisfy:voidai:gpt-image-1 (12000 credits)",
      "gratisfy:voidai:gpt-4o-mini-tts (250 credits)",
    ],
    xyzConversion: null,
    usdPerUnit: null,
    billsInXyz: false,
    description: "VoidAI's flat per-call credits. The credit cost appears in pricing.inputDisplay (e.g. \"250 credits fixed\"). No published USD-per-credit rate. The gateway treats them as BYOK (user's own VoidAI/Gratisfy key bills directly; platform XYZ charge = 0).",
  },
  {
    id: "tokens-day",
    name: "Tokens/day (free-tier budget, NOT a price)",
    unitSuffixes: ["/day (display only)"],
    providers: ["navy", "paxsenix", "routmy", "voidai"],
    exampleModels: [
      "gratisfy:routmy:x-ai/grok-imagine-video-1.5-preview (1.6M tokens/day)",
      "gratisfy:routmy:minimax/minimax-m2.5 (650K tokens/day)",
    ],
    xyzConversion: null,
    usdPerUnit: null,
    billsInXyz: false,
    description: "Free-tier daily token budget shown in display fields. NOT a price — it's a quota. The actual pricing.input/output is null (free). The gateway bills these as free (XYZ = 0).",
  },
];

/** Derive the neurons-per-XYZ rate from a cloudflare model's USD + neurons/M. */
export function deriveNeuronsPerXyz(
  usdPerMillion: number,
  neuronsPerMillion: number,
): number | null {
  if (!usdPerMillion || !neuronsPerMillion) return null;
  const usdPerNeuron = usdPerMillion / neuronsPerMillion;
  if (!usdPerNeuron || !Number.isFinite(usdPerNeuron)) return null;
  // 1 XYZ = 1 USD (default multiplier) → 1 XYZ = 1/usdPerNeuron neurons.
  return Math.round(1 / usdPerNeuron);
}

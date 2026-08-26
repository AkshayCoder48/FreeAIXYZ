import type { FreeClassification, UnifiedModel } from "../types";

/**
 * SpicyWriter free classification — based on the LIVE upstream response's
 * tier metadata (NOT on naming patterns):
 *
 *   - tierType==="LITE"              → FREE (anonymous BASIC users get 150
 *                                     requests/day per LITE model; with anon
 *                                     user id rotation this is unlimited)
 *   - tierType==="BALANCED"          → NOT FREE for anonymous users. The 10x
 *                                     reliability sweep (2026-08-26) confirmed
 *                                     that BALANCED-tier models return HTTP 500
 *                                     for anonymous calls — they require a
 *                                     logged-in BASIC account, not anonymous
 *                                     access. (Previously misclassified as free.)
 *   - tierType==="ADVANCED" +        → NOT FREE (PRO tier required, daily
 *     requiredTier==="PRO"             quota 0 for BASIC)
 *
 * This auto-detects new LITE free models like "Ox Alpha" (the "0x" model the
 * user mentioned), "Gemma 4 31B T", "Lunaris", "Ling 2.6 Flash", and
 * "Nemo" without any hardcoding — PRD §21. Individual LITE models that
 * still fail upstream are delisted in src/lib/gateway/delisted.ts.
 */
export function classifyFree(model: UnifiedModel): FreeClassification {
  const raw = model.raw as {
    tierType?: string;
    requiredTier?: string | null;
  } | null;
  const tier = raw?.tierType?.toUpperCase();
  const required = raw?.requiredTier?.toUpperCase();

  if (tier === "LITE") {
    return {
      free: true,
      confidence: "provider",
      reason: "spicywriter tierType=LITE (free for anonymous BASIC users)",
    };
  }
  if (tier === "BALANCED") {
    return {
      free: false,
      confidence: "provider",
      reason: "spicywriter tierType=BALANCED (requires logged-in BASIC account, fails for anonymous)",
    };
  }
  if (tier === "ADVANCED" || required === "PRO") {
    return {
      free: false,
      confidence: "provider",
      reason: "spicywriter tierType=ADVANCED/requiredTier=PRO (paid)",
    };
  }
  // Unknown tier — fall back to pattern matching on the name.
  if (/free|lite|0x|ox/i.test(model.modelId)) {
    return {
      free: true,
      confidence: "pattern",
      reason: "fallback: name matches /free|lite|ox/i (spicywriter pattern)",
    };
  }
  return {
    free: false,
    confidence: "unknown",
    reason: "spicywriter: unknown tier, no pattern match",
  };
}

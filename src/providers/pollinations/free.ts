import type { FreeClassification, UnifiedModel } from "../types";

/**
 * Pollinations is `entirely_free` — every model returned by the upstream is
 * free (PRD §16). No paid tier exists.
 */
export function classifyFree(model: UnifiedModel): FreeClassification {
  return {
    free: true,
    confidence: "provider",
    reason: "pollinations is entirely_free (all models free, no auth)",
  };
}

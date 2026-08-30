import type { FreeClassification, UnifiedModel } from "../types";

/** FreeAIXYZ is entirely_free — 3-step curl flow with self-healing nonces,
 *  no key required. */
export function classifyFree(_model: UnifiedModel): FreeClassification {
  return {
    free: true,
    confidence: "provider",
    reason: "freeaixyz is entirely_free (anonymous WordPress flow)",
  };
}

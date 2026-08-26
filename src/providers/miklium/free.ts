import type { FreeClassification, UnifiedModel } from "../types";

/** Miklium is entirely_free — no signup, no key. */
export function classifyFree(_model: UnifiedModel): FreeClassification {
  return {
    free: true,
    confidence: "provider",
    reason: "miklium is entirely_free (no signup)",
  };
}

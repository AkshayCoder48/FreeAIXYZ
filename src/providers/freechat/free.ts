import type { FreeClassification, UnifiedModel } from "../types";

/** FreeChat is entirely_free — credits regenerate, no key needed. */
export function classifyFree(_model: UnifiedModel): FreeClassification {
  return {
    free: true,
    confidence: "provider",
    reason: "freechat is entirely_free (credit-regenerating, no key)",
  };
}

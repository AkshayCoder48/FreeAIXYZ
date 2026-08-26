import type { FreeClassification, UnifiedModel } from "../types";

/** UnlimitedAI is entirely_free — no auth, no filters, NDJSON streaming. */
export function classifyFree(_model: UnifiedModel): FreeClassification {
  return {
    free: true,
    confidence: "provider",
    reason: "unlimitedai is entirely_free (no auth, NDJSON streaming)",
  };
}

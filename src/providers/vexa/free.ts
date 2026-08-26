import type { FreeClassification, UnifiedModel } from "../types";

/** Vexa is entirely_free — every model surfaced (manual list) is free. */
export function classifyFree(_model: UnifiedModel): FreeClassification {
  return {
    free: true,
    confidence: "provider",
    reason: "vexa is entirely_free (no key, SSE streaming)",
  };
}

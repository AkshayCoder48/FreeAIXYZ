import type { FreeClassification, UnifiedModel } from "../types";

/** SurfSense is entirely_free — no login, no key, real token streaming. */
export function classifyFree(_model: UnifiedModel): FreeClassification {
  return {
    free: true,
    confidence: "provider",
    reason: "surfsense is entirely_free (no login, anon chat)",
  };
}

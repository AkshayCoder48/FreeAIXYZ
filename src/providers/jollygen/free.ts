import type { FreeClassification, UnifiedModel } from "../types";

/** JollyGen is entirely_free — rotated guest hash, no content filters. */
export function classifyFree(_model: UnifiedModel): FreeClassification {
  return {
    free: true,
    confidence: "provider",
    reason: "jollygen is entirely_free (rotated guest identity)",
  };
}

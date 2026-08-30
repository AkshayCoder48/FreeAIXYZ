import type { FreeClassification, UnifiedModel } from "../types";

/** Swarm is entirely_free — every GGUF model in the swarm is free, no auth. */
export function classifyFree(_model: UnifiedModel): FreeClassification {
  return {
    free: true,
    confidence: "provider",
    reason: "swarm is entirely_free (community-hosted, no auth)",
  };
}

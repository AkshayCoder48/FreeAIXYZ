import type { FreeClassification, UnifiedModel } from "../types";

/** AuroraAI is entirely_free — anonymous roleplay API, no key, no payment. */
export function classifyFree(_model: UnifiedModel): FreeClassification {
  return {
    free: true,
    confidence: "provider",
    reason: "auroraai is entirely_free (anonymous per-request identity)",
  };
}

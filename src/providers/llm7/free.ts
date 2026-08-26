import type { FreeClassification, UnifiedModel } from "../types";
import { BLOCKED_LLM7 } from "./discover";

/**
 * LLM7 is hybrid — most anonymous models are free, but a known blocked set
 * returns 401 (subscription) or 400 (unavailable). Models with `Inkling`
 * prefix are also flagged offline upstream.
 *
 * Free classification:
 *   - Blocked set → NOT free (would fail when called)
 *   - Everything else → free (anonymous access works — confirmed by audit)
 */
export function classifyFree(model: UnifiedModel): FreeClassification {
  const id = model.modelId;
  if (BLOCKED_LLM7.has(id)) {
    return {
      free: false,
      confidence: "confirmed",
      reason: "llm7 BLOCKED set — returns 401/400 on anonymous call",
    };
  }
  return {
    free: true,
    confidence: "provider",
    reason: "llm7 hybrid — anonymous calls succeed",
  };
}

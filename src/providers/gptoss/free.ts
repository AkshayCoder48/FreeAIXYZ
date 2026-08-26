import type { FreeClassification, UnifiedModel } from "../types";

/** GPT-OSS is entirely_free (no API key), but currently broken upstream.
 *  We still classify the models as `free` since no payment is required —
 *  they're just temporarily unavailable. */
export function classifyFree(_model: UnifiedModel): FreeClassification {
  return {
    free: true,
    confidence: "provider",
    reason: "gptoss is entirely_free (no key) — broken upstream but free",
  };
}

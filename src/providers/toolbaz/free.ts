import type { FreeClassification, UnifiedModel } from "../types";

/** Toolbaz is entirely_free — every model surfaced (hardcoded list) is free.
 *  Note: the chat endpoint is currently captcha-bound; gateway surfaces a
 *  structured error rather than empty content. */
export function classifyFree(_model: UnifiedModel): FreeClassification {
  return {
    free: true,
    confidence: "provider",
    reason: "toolbaz is entirely_free (no key, captcha-bound but free)",
  };
}

import type { FreeClassification, UnifiedModel } from "../types";

/**
 * FreeGPT.tech is the FREE arm of the gateway — every model surfaced is
 * supposed to be free (WASM-secured, no key, anonymous). Pattern: any id
 * matching `/free$/i` is unambiguously free; everything else is also free
 * because the upstream's whole purpose is anonymous free access.
 */
export function classifyFree(model: UnifiedModel): FreeClassification {
  const id = model.modelId;
  if (/free$/i.test(id) || /(^|[-:_])free([-:_]|$)/i.test(id)) {
    return {
      free: true,
      confidence: "pattern",
      reason: "matches /free$/i (freegpt free-tier suffix)",
    };
  }
  return {
    free: true,
    confidence: "provider",
    reason: "freegpt is free-only by design (anonymous, no key)",
  };
}

import type { FreeClassification, UnifiedModel } from "../types";

/**
 * Kilo Code uses OpenRouter-style `:free` suffix to mark free-tier models.
 * Pattern: `/free$/i` (matches `:free`, `-free`, `_free`). Paid entries
 * end with `:paid` or have no `:free` suffix.
 */
export function classifyFree(model: UnifiedModel): FreeClassification {
  const id = model.modelId;
  if (/free$/i.test(id)) {
    return {
      free: true,
      confidence: "pattern",
      reason: `matches /free$/i (kilocode pattern — :free suffix)`,
    };
  }
  return {
    free: false,
    confidence: "pattern",
    reason: `no /free$/i suffix (kilocode pattern — paid)`,
  };
}

import type { ProviderModel, UnifiedModel } from "../types";

const PROVIDER_ID = "spicywriter";

/** Normalize a SpicyWriter raw item. The chat payload sends the model NAME
 *  (e.g. "Ox Alpha", "Ling 2.6 Flash") as the `model` field — so `modelId`
 *  is the upstream name, not the numeric `id`. Tier metadata is preserved
 *  on `raw` so `free.ts` can classify. */
export function normalizeModel(raw: ProviderModel): UnifiedModel {
  const id = raw.id; // this is the upstream NAME (per discover.ts idField)
  const now = new Date().toISOString();
  const data = raw.raw as {
    tierType?: string;
    requiredTier?: string | null;
    contextWindow?: number;
    legacy?: boolean;
    thinkingMode?: string;
  } | null;
  const thinking = data?.thinkingMode === "ALWAYS" || data?.thinkingMode === "OPTIONAL";
  return {
    id: `${PROVIDER_ID}:${id}`,
    providerId: PROVIDER_ID,
    modelId: id,
    name: raw.name ?? id,
    type: "chat",
    free: false, // set by free.ts based on tierType
    freeConfidence: "unknown",
    capabilities: {
      streaming: true,
      tools: true,
      vision: false,
      audio: false,
      reasoning: thinking,
    },
    status: "active",
    firstSeenAt: now,
    lastSeenAt: now,
    raw: raw.raw,
  };
}

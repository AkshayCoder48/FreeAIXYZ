import type { ProviderModel, UnifiedModel } from "../types";

const PROVIDER_ID = "freeaixyz";

export function normalizeModel(raw: ProviderModel): UnifiedModel {
  const id = raw.id;
  const now = new Date().toISOString();
  const hasSearch = id.endsWith("-search");
  return {
    id: `${PROVIDER_ID}:${id}`,
    providerId: PROVIDER_ID,
    modelId: id,
    name: raw.name ?? id,
    type: "chat",
    free: true,
    freeConfidence: "provider",
    capabilities: {
      streaming: true,
      tools: true,
      vision: true, // freeaixyz supports image inputs
      audio: false,
      reasoning: false,
    },
    status: "active",
    firstSeenAt: now,
    lastSeenAt: now,
    raw: { ...(raw.raw as Record<string, unknown>), hasWebSearch: hasSearch },
  };
}

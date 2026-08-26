import type { ProviderModel, UnifiedModel } from "../types";

const PROVIDER_ID = "miklium";

export function normalizeModel(raw: ProviderModel): UnifiedModel {
  const id = raw.id;
  const now = new Date().toISOString();
  return {
    id: `${PROVIDER_ID}:${id}`,
    providerId: PROVIDER_ID,
    modelId: id,
    name: raw.name ?? id,
    type: "chat",
    free: true,
    freeConfidence: "provider",
    capabilities: {
      streaming: false, // miklium returns full JSON, no token streaming
      tools: false,
      vision: false,
      audio: false,
      reasoning: false,
    },
    status: "active",
    firstSeenAt: now,
    lastSeenAt: now,
    raw: raw.raw,
  };
}

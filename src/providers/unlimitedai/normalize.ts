import type { ProviderModel, UnifiedModel } from "../types";

const PROVIDER_ID = "unlimitedai";

export function normalizeModel(raw: ProviderModel): UnifiedModel {
  const id = raw.id;
  const now = new Date().toISOString();
  const isSearch = /with-search|web/i.test(id);
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
      vision: false,
      audio: false,
      reasoning: true,
    },
    status: "active",
    firstSeenAt: now,
    lastSeenAt: now,
    raw: { ...(raw.raw as Record<string, unknown>), hasWebSearch: isSearch },
  };
}

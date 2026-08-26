import type { ProviderModel, UnifiedModel } from "../types";

const PROVIDER_ID = "swarm";

export function normalizeModel(raw: ProviderModel): UnifiedModel {
  const id = raw.id;
  const now = new Date().toISOString();
  const lower = id.toLowerCase();
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
      reasoning: /reason|reasoning|uncensored/i.test(lower),
    },
    status: "active",
    firstSeenAt: now,
    lastSeenAt: now,
    raw: raw.raw,
  };
}

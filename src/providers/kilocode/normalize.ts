import type { ProviderModel, UnifiedModel } from "../types";

const PROVIDER_ID = "kilocode";

export function normalizeModel(raw: ProviderModel): UnifiedModel {
  const id = raw.id;
  const now = new Date().toISOString();
  return {
    id: `${PROVIDER_ID}:${id}`,
    providerId: PROVIDER_ID,
    modelId: id,
    name: raw.name ?? id,
    type: "chat",
    free: false,
    freeConfidence: "unknown",
    capabilities: {
      streaming: true,
      tools: true,
      vision: false,
      audio: false,
      reasoning: /reason|reasoning|deepseek|nemotron/i.test(id),
    },
    status: "active",
    firstSeenAt: now,
    lastSeenAt: now,
    raw: raw.raw,
  };
}

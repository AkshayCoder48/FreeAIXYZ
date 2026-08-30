import type { ProviderModel, UnifiedModel } from "../types";

const PROVIDER_ID = "gptoss";

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
      streaming: true,
      tools: false,
      vision: false,
      audio: false,
      reasoning: true,
    },
    // Audit confirmed: GPT-OSS worker returns 200 OK with empty content.
    status: "temporarily_unavailable",
    firstSeenAt: now,
    lastSeenAt: now,
    raw: raw.raw,
  };
}

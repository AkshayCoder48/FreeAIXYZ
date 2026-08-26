import type { ProviderModel, UnifiedModel } from "../types";

const PROVIDER_ID = "toolbaz";

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
      streaming: true, // gateway wraps single chunk into real SSE (audit G1)
      tools: true,
      vision: false,
      audio: false,
      reasoning: /reason|reasoning|o3|deepseek-r1/i.test(id),
    },
    status: "active",
    firstSeenAt: now,
    lastSeenAt: now,
    raw: raw.raw,
  };
}

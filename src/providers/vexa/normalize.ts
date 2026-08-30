import type { ProviderModel, UnifiedModel } from "../types";

const PROVIDER_ID = "vexa";

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
      reasoning: false,
    },
    // gpt-4.1-nano is broken upstream ("No provider available" — audit).
    status: id === "gpt-4.1-nano" ? "temporarily_unavailable" : "active",
    firstSeenAt: now,
    lastSeenAt: now,
    raw: raw.raw,
  };
}

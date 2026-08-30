import type { ProviderModel, UnifiedModel } from "../types";

const PROVIDER_ID = "pollinations";

/** Normalize a Pollinations raw item. Image models (flux/turbo/sdxl/image
 *  in id) are typed `image` with `imageGeneration` capability. */
export function normalizeModel(raw: ProviderModel): UnifiedModel {
  const id = raw.id;
  const now = new Date().toISOString();
  const lower = id.toLowerCase();
  const isImage = /flux|turbo|sdxl|image/.test(lower);
  return {
    id: `${PROVIDER_ID}:${id}`,
    providerId: PROVIDER_ID,
    modelId: id,
    name: raw.name ?? id,
    type: isImage ? "image" : "chat",
    free: true,
    freeConfidence: "provider",
    capabilities: {
      streaming: !isImage,
      imageGeneration: isImage,
      vision: false,
      audio: false,
      tools: !isImage,
      reasoning: /reason|reasoning/.test(lower),
    },
    status: "active",
    firstSeenAt: now,
    lastSeenAt: now,
    raw: raw.raw,
  };
}

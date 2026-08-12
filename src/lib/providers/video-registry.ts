/**
 * Video model registry — currently no video providers available.
 *
 * Previously supported:
 *   - dreemy        — Dreemy.ai (removed: guests have 0 credits, BYOK-only)
 *   - nsfw-gateway  — NSFW Gateway (removed: BYOK-only, unreliable)
 *
 * Video generation may be re-added with a free provider in the future.
 */

export type VideoProviderId = "none";

export type VideoCategory =
  | "general"
  | "animation"
  | "anime"
  | "face-swap"
  | "unrestricted";

export interface VideoModel {
  id: string;
  name: string;
  provider: VideoProviderId;
  category: VideoCategory;
  upstreamModel: string;
  needsImage: boolean;
  defaultDuration: number;
  nsfw: boolean;
  description: string;
}

export const VIDEO_MODELS: readonly VideoModel[] = [];

/** Quick lookup by id. */
export function findVideoModel(id: string): VideoModel | undefined {
  return VIDEO_MODELS.find((m) => m.id === id);
}

/** Count by category. */
export function videoModelCounts(): Record<VideoCategory, number> {
  const counts: Record<VideoCategory, number> = {
    general: 0, animation: 0, anime: 0, "face-swap": 0, unrestricted: 0,
  };
  for (const m of VIDEO_MODELS) counts[m.category]++;
  return counts;
}

export const VIDEO_PROVIDER_INFO: Record<
  VideoProviderId,
  { name: string; description: string; baseUrl: string; authType: string }
> = {
  none: {
    name: "No Provider",
    description: "No video generation providers currently available.",
    baseUrl: "",
    authType: "",
  },
};

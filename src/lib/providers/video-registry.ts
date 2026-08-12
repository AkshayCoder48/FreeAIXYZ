/**
 * Video model registry — NSFW Gateway video generation models.
 *
 * BYOK = Bring Your Own Key. User provides their JWT token from nsfwimg2video.com.
 * Gateway has CORS: * so browser can call directly. Token stays in sessionStorage.
 *
 * Provider: nsfw-gateway (gateway.nsfwimg2video.com)
 * Models: text2video, image2video, anime-girl, fast-face-swap
 */

export type VideoProviderId = "nsfw-gateway";

export type VideoCategory =
  | "general"
  | "animation"
  | "anime"
  | "face-swap";

export interface VideoModel {
  id: string;
  name: string;
  provider: VideoProviderId;
  category: VideoCategory;
  upstreamModel: string; // The model path in the gateway URL
  needsImage: boolean; // Whether the model requires a source image (resourceId)
  defaultDuration: number; // Default video duration in seconds
  nsfw: boolean;
  description: string;
}

const NSFW_GATEWAY_VIDEO_MODELS: VideoModel[] = [
  {
    id: "nsgw-text2video",
    name: "Text2Video (NSFW Gateway)",
    provider: "nsfw-gateway",
    category: "general",
    upstreamModel: "text2video",
    needsImage: false,
    defaultDuration: 5,
    nsfw: true,
    description: "Generate video from text prompt only — no source image needed. Describe a scene and get a video clip.",
  },
  {
    id: "nsgw-image2video",
    name: "Image2Video (NSFW Gateway)",
    provider: "nsfw-gateway",
    category: "animation",
    upstreamModel: "image2video",
    needsImage: true,
    defaultDuration: 5,
    nsfw: true,
    description: "Animate an uploaded image according to a text prompt. e.g. 'Make her dance' — the core feature of the platform.",
  },
  {
    id: "nsgw-anime-girl",
    name: "Anime Girl (NSFW Gateway)",
    provider: "nsfw-gateway",
    category: "anime",
    upstreamModel: "anime-girl",
    needsImage: true,
    defaultDuration: 5,
    nsfw: true,
    description: "Anime-style character generator/animation — produces anime art from a source image and animates it.",
  },
  {
    id: "nsgw-face-swap",
    name: "Fast Face Swap (NSFW Gateway)",
    provider: "nsfw-gateway",
    category: "face-swap",
    upstreamModel: "fast-face-swap",
    needsImage: true,
    defaultDuration: 5,
    nsfw: true,
    description: "Fast face-swap model — replaces a face in video content with a supplied face image. Optimized for speed over quality.",
  },
];

export const VIDEO_MODELS: readonly VideoModel[] = [
  ...NSFW_GATEWAY_VIDEO_MODELS,
];

/** Quick lookup by id. */
export function findVideoModel(id: string): VideoModel | undefined {
  return VIDEO_MODELS.find((m) => m.id === id);
}

/** Count by category. */
export function videoModelCounts(): Record<VideoCategory, number> {
  const counts: Record<VideoCategory, number> = {
    general: 0, animation: 0, anime: 0, "face-swap": 0,
  };
  for (const m of VIDEO_MODELS) counts[m.category]++;
  return counts;
}

export const VIDEO_PROVIDER_INFO: Record<
  VideoProviderId,
  { name: string; description: string; baseUrl: string; authType: string }
> = {
  "nsfw-gateway": {
    name: "NSFW Gateway",
    description: "Image & Video generation via gateway.nsfwimg2video.com. BYOK (bring your own JWT token) — 5 models including text2video, image2video, anime-girl, wf (image), fast-face-swap. CORS open, browser-direct calls supported.",
    baseUrl: "https://gateway.nsfwimg2video.com",
    authType: "BYOK — JWT token from nsfwimg2video.com",
  },
};

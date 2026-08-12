/**
 * Video model registry — Dreemy.ai and NSFW Gateway video generation models.
 *
 * Providers:
 *   - dreemy        — Dreemy.ai text-to-video (BYOK or auto guest mint)
 *   - nsfw-gateway  — NSFW Gateway BYOK (gateway.nsfwimg2video.com)
 *
 * Models: dreemy-text2video, text2video, image2video, anime-girl, fast-face-swap
 */

export type VideoProviderId = "dreemy" | "nsfw-gateway";

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
  upstreamModel: string; // The model path in the gateway URL
  needsImage: boolean; // Whether the model requires a source image (resourceId)
  defaultDuration: number; // Default video duration in seconds
  nsfw: boolean;
  description: string;
}

// ─── Dreemy video models (dreemy.ai, BYOK or auto guest mint) ──────────────────
// Dreemy.ai POST /api/aiVideo/create/v2 — async job polling
// Same auth as image: dreemy_token (x-auth-token) or auto-mint guest
const DREEMY_VIDEO_MODELS: VideoModel[] = [
  {
    id: "dreemy-text2video",
    name: "Text2Video (Dreemy)",
    provider: "dreemy",
    category: "unrestricted",
    upstreamModel: "text2video",
    needsImage: false,
    defaultDuration: 5,
    nsfw: true,
    description: "Generate video from text prompt via Dreemy.ai. BYOK (dreemy_token) or auto-mint guest. 100 credits per video.",
  },
  {
    id: "dreemy-image2video",
    name: "Image2Video (Dreemy)",
    provider: "dreemy",
    category: "animation",
    upstreamModel: "image2video",
    needsImage: true,
    defaultDuration: 5,
    nsfw: true,
    description: "Animate an image according to text prompt via Dreemy.ai. Requires source image. BYOK or auto-mint guest.",
  },
];

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
  ...DREEMY_VIDEO_MODELS,
  ...NSFW_GATEWAY_VIDEO_MODELS,
];

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
  dreemy: {
    name: "Dreemy.ai",
    description: "AI Video generation via dreemy.ai. Text2Video and Image2Video. BYOK (pass dreemy_token) or auto-mint guest token (100 credits). Async job polling.",
    baseUrl: "https://www.dreemy.ai",
    authType: "BYOK (dreemy_token) or auto guest mint (createGuest → loginByGuest)",
  },
  "nsfw-gateway": {
    name: "NSFW Gateway",
    description: "Image & Video generation via gateway.nsfwimg2video.com. BYOK (bring your own JWT token) — 5 models including text2video, image2video, anime-girl, wf (image), fast-face-swap. CORS open, browser-direct calls supported.",
    baseUrl: "https://gateway.nsfwimg2video.com",
    authType: "BYOK — JWT token from nsfwimg2video.com",
  },
};

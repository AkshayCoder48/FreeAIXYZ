/**
 * Image model registry — REAL AI generators only, base models only.
 *
 * No style-prompt variants. Each underlying model is one entry.
 * Most providers are 100% free, no signup, no API key, instant (no queues).
 * No image fetchers. No AI Horde.
 *
 * Providers:
 *   - pollinations-gen — image.pollinations.ai (1 model, unlimited)
 *   - freegpt          — FreeGPT.tech image models (4 real AI models)
 *   - casper-tech      — Casper Technology via ai-image-gen.xcasper.space (2 models)
 *
 * Total: 7 base models.
 *
 * Casper Tech also provides image manipulation endpoints (not generation models):
 *   - POST /v1/image/mask/generate      — Image + mask edit
 *   - POST /v1/image/variation/generate — Image variation
 *   - POST /v1/image/analyze/generate   — Image-to-prompt analysis
 * These are exposed as separate API routes, not as generation models.
 */

export type ImageProviderId =
  | "pollinations-gen"
  | "freegpt"
  | "casper-tech";

export type ImageCategory =
  | "anime"
  | "realism"
  | "mixed"
  | "general";

export interface ImageModel {
  id: string;
  name: string;
  provider: ImageProviderId;
  category: ImageCategory;
  upstreamModel?: string;
  width: number;
  height: number;
  stylePrompt?: string;
  negativePrompt?: string;
  steps?: number;
  cfgScale?: number;
  nsfw: boolean;
  description: string;
}

// ─── Pollinations base model (1 real AI generation model) ──────────────────
const POLL_MODELS: ImageModel[] = [
  { id: "poll-flux", name: "Flux (Pollinations)", provider: "pollinations-gen", category: "mixed", upstreamModel: "flux", width: 1024, height: 1024, nsfw: false, description: "Black Forest Labs Flux — versatile, high-quality, photorealistic and artistic" },
];

// ─── FreeGPT image models (4 real AI generators, WASM-secured, no key) ──────
const FREEGPT_MODELS: ImageModel[] = [
  { id: "freegpt-gpt-image-2", name: "GPT-Image 2 (FreeGPT)", provider: "freegpt", category: "general", upstreamModel: "gpt-image-2", width: 1024, height: 1024, nsfw: false, description: "OpenAI GPT-Image 2 via FreeGPT.tech — high-quality generation" },
  { id: "freegpt-nano-banana-2", name: "Nano Banana 2 (FreeGPT)", provider: "freegpt", category: "realism", upstreamModel: "nano-banana-2", width: 1024, height: 1024, nsfw: false, description: "Google Gemini Nano Banana 2 via FreeGPT.tech — photorealistic" },
  { id: "freegpt-flux-2-flex", name: "Flux 2 Flex (FreeGPT)", provider: "freegpt", category: "realism", upstreamModel: "flux-2-flex", width: 1024, height: 1024, nsfw: false, description: "Black Forest Labs Flux 2 Flex via FreeGPT.tech — photorealistic" },
  { id: "freegpt-gemini-flash-image", name: "Gemini Flash Image (FreeGPT)", provider: "freegpt", category: "general", upstreamModel: "gemini-3.1-flash-image", width: 1024, height: 1024, nsfw: false, description: "Google Gemini 3.1 Flash Image via FreeGPT.tech — fast, high-quality" },
];

// ─── Casper Tech image models (2 AI generators, free, no key) ──────────────
const CASPER_MODELS: ImageModel[] = [
  { id: "casper-deepai", name: "DeepAI Text2Img (Casper)", provider: "casper-tech", category: "general", upstreamModel: "deepai", width: 1024, height: 1024, nsfw: false, description: "DeepAI engine via Casper Tech — fast text-to-image generation, no API key required" },
  { id: "casper-magic", name: "Magic Studio (Casper)", provider: "casper-tech", category: "mixed", upstreamModel: "bing", width: 1024, height: 1024, nsfw: false, description: "Casper Tech Magic Studio — high-quality creative image generation via Bing engine" },
];

export const IMAGE_MODELS: readonly ImageModel[] = [
  ...POLL_MODELS,
  ...FREEGPT_MODELS,
  ...CASPER_MODELS,
];

/** Quick lookup by id. */
export function findImageModel(id: string): ImageModel | undefined {
  return IMAGE_MODELS.find((m) => m.id === id);
}

/** Count by category. */
export function imageModelCounts(): Record<ImageCategory, number> {
  const counts: Record<ImageCategory, number> = {
    anime: 0, realism: 0, mixed: 0, general: 0,
  };
  for (const m of IMAGE_MODELS) counts[m.category]++;
  return counts;
}

/** Casper Tech base URL for image generation and manipulation APIs. */
export const CASPER_BASE_URL = "https://ai-image-gen.xcasper.space";

export const IMAGE_PROVIDER_INFO: Record<
  ImageProviderId,
  { name: string; description: string }
> = {
  "pollinations-gen": {
    name: "Pollinations",
    description: "1 real AI image generation model (Flux). Unlimited, free, no signup, instant (~0.3-1s per image).",
  },
  freegpt: {
    name: "FreeGPT.tech",
    description: "4 real AI image models (GPT-Image 2, Nano Banana 2, Flux 2 Flex, Gemini Flash Image) via FreeGPT.tech's WASM-secured endpoint. No key needed.",
  },
  "casper-tech": {
    name: "Casper Tech",
    description: "2 AI image models (DeepAI Text2Img, Magic Studio) via ai-image-gen.xcasper.space. Free, no API key. Also provides mask edit, variation, and image-to-prompt APIs.",
  },
};

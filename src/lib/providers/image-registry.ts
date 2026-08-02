/**
 * Image model registry — REAL AI generators only, base models only.
 *
 * No style-prompt variants. Each underlying model is one entry.
 * All providers are 100% free, no signup, no API key, instant (no queues).
 * No image fetchers. No BYOK. No AI Horde.
 *
 * Providers:
 *   - pollinations-gen — image.pollinations.ai (6 real AI models, unlimited)
 *   - freegpt          — FreeGPT.tech image models (5 real AI models)
 *
 * Total: 11 base models.
 */

export type ImageProviderId =
  | "pollinations-gen"
  | "freegpt";

export type ImageCategory =
  | "anime"
  | "realism"
  | "mixed"
  | "general"
  | "nsfw-anime"
  | "nsfw-realism"
  | "nsfw-mixed";

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

// ─── Pollinations base models (6 real AI generation models) ─────────────────
// Verified working 3/3 multi-request: flux, turbo, dreamshaper, gptimage,
// qwen-image, grok-imagine. All return real JPEG images, ~0.3-1s, unlimited.
const POLL_MODELS: ImageModel[] = [
  { id: "poll-flux", name: "Flux (Pollinations)", provider: "pollinations-gen", category: "mixed", upstreamModel: "flux", width: 1024, height: 1024, nsfw: false, description: "Black Forest Labs Flux — versatile, high-quality, photorealistic and artistic" },
  { id: "poll-turbo", name: "Turbo (Pollinations)", provider: "pollinations-gen", category: "mixed", upstreamModel: "turbo", width: 1024, height: 1024, nsfw: false, description: "Fast SDXL Turbo — quick generations, good quality" },
  { id: "poll-dreamshaper", name: "Dreamshaper (Pollinations)", provider: "pollinations-gen", category: "mixed", upstreamModel: "dreamshaper", width: 1024, height: 1024, nsfw: false, description: "Dreamshaper — artistic, dreamy illustrations and portraits" },
  { id: "poll-gptimage", name: "GPT-Image (Pollinations)", provider: "pollinations-gen", category: "general", upstreamModel: "gptimage", width: 1024, height: 1024, nsfw: false, description: "OpenAI GPT-Image — high-quality general-purpose generation" },
  { id: "poll-qwen-image", name: "Qwen-Image (Pollinations)", provider: "pollinations-gen", category: "mixed", upstreamModel: "qwen-image", width: 1024, height: 1024, nsfw: false, description: "Alibaba Qwen-Image — detailed, artistic, multi-style" },
  { id: "poll-grok-imagine", name: "Grok-Imagine (Pollinations)", provider: "pollinations-gen", category: "mixed", upstreamModel: "grok-imagine", width: 1024, height: 1024, nsfw: false, description: "xAI Grok Imagine — creative, detailed generation" },
];

// ─── FreeGPT image models (5 real AI generators, WASM-secured, no key) ──────
const FREEGPT_MODELS: ImageModel[] = [
  { id: "freegpt-gpt-image-2", name: "GPT-Image 2 (FreeGPT)", provider: "freegpt", category: "general", upstreamModel: "gpt-image-2", width: 1024, height: 1024, nsfw: false, description: "OpenAI GPT-Image 2 via FreeGPT.tech — high-quality generation" },
  { id: "freegpt-nano-banana-2", name: "Nano Banana 2 (FreeGPT)", provider: "freegpt", category: "realism", upstreamModel: "nano-banana-2", width: 1024, height: 1024, nsfw: false, description: "Google Gemini Nano Banana 2 via FreeGPT.tech — photorealistic" },
  { id: "freegpt-flux-2-flex", name: "Flux 2 Flex (FreeGPT)", provider: "freegpt", category: "realism", upstreamModel: "flux-2-flex", width: 1024, height: 1024, nsfw: false, description: "Black Forest Labs Flux 2 Flex via FreeGPT.tech — photorealistic" },
  { id: "freegpt-grok-imagine", name: "Grok-Imagine (FreeGPT)", provider: "freegpt", category: "mixed", upstreamModel: "grok-imagine", width: 1024, height: 1024, nsfw: false, description: "xAI Grok Imagine via FreeGPT.tech — creative generation" },
  { id: "freegpt-gemini-flash-image", name: "Gemini Flash Image (FreeGPT)", provider: "freegpt", category: "general", upstreamModel: "gemini-3.1-flash-image", width: 1024, height: 1024, nsfw: false, description: "Google Gemini 3.1 Flash Image via FreeGPT.tech — fast, high-quality" },
];

export const IMAGE_MODELS: readonly ImageModel[] = [
  ...POLL_MODELS,
  ...FREEGPT_MODELS,
];

/** Quick lookup by id. */
export function findImageModel(id: string): ImageModel | undefined {
  return IMAGE_MODELS.find((m) => m.id === id);
}

/** Count by category. */
export function imageModelCounts(): Record<ImageCategory, number> {
  const counts: Record<ImageCategory, number> = {
    anime: 0, realism: 0, mixed: 0, general: 0,
    "nsfw-anime": 0, "nsfw-realism": 0, "nsfw-mixed": 0,
  };
  for (const m of IMAGE_MODELS) counts[m.category]++;
  return counts;
}

export const IMAGE_PROVIDER_INFO: Record<
  ImageProviderId,
  { name: string; description: string }
> = {
  "pollinations-gen": {
    name: "Pollinations",
    description: "6 real AI image generation models (Flux, Turbo, Dreamshaper, GPT-Image, Qwen-Image, Grok-Imagine). Unlimited, free, no signup, instant (~0.3-1s per image).",
  },
  freegpt: {
    name: "FreeGPT.tech",
    description: "5 real AI image models (GPT-Image 2, Nano Banana 2, Flux 2 Flex, Grok-Imagine, Gemini Flash Image) via FreeGPT.tech's WASM-secured endpoint. No key needed.",
  },
};

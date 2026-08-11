/**
 * Image model registry — REAL AI generators only, base models only.
 *
 * No style-prompt variants. Each underlying model is one entry.
 * All providers are 100% free, no signup, no API key, instant (no queues).
 * No image fetchers. No BYOK. No AI Horde.
 *
 * Providers:
 *   - pollinations-gen — image.pollinations.ai (5 real AI models, unlimited)
 *   - freegpt          — FreeGPT.tech image models (4 real AI models)
 *   - freepikai        — FreepikAI.net 4MP image gen (6 style models, Turnstile-verified)
 *   - freegen          — FreeGen WebSocket task queue (1 model)
 *
 * Total: 16 base models.
 */

export type ImageProviderId =
  | "pollinations-gen"
  | "freegpt"
  | "freepikai"
  | "freegen"
  | "aianime";

export type ImageCategory =
  | "anime"
  | "realism"
  | "mixed"
  | "general"
  | "unrestricted-anime"
  | "unrestricted-realism"
  | "unrestricted-mixed";

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

// ─── Pollinations base models (5 real AI generation models) ─────────────────
// Removed: poll-grok-imagine (times out / unreliable)
const POLL_MODELS: ImageModel[] = [
  { id: "poll-flux", name: "Flux (Pollinations)", provider: "pollinations-gen", category: "mixed", upstreamModel: "flux", width: 1024, height: 1024, nsfw: false, description: "Black Forest Labs Flux — versatile, high-quality, photorealistic and artistic" },
  { id: "poll-turbo", name: "Turbo (Pollinations)", provider: "pollinations-gen", category: "mixed", upstreamModel: "turbo", width: 1024, height: 1024, nsfw: false, description: "Fast SDXL Turbo — quick generations, good quality" },
  { id: "poll-dreamshaper", name: "Dreamshaper (Pollinations)", provider: "pollinations-gen", category: "mixed", upstreamModel: "dreamshaper", width: 1024, height: 1024, nsfw: false, description: "Dreamshaper — artistic, dreamy illustrations and portraits" },
  { id: "poll-gptimage", name: "GPT-Image (Pollinations)", provider: "pollinations-gen", category: "general", upstreamModel: "gptimage", width: 1024, height: 1024, nsfw: false, description: "OpenAI GPT-Image — high-quality general-purpose generation" },
  { id: "poll-qwen-image", name: "Qwen-Image (Pollinations)", provider: "pollinations-gen", category: "mixed", upstreamModel: "qwen-image", width: 1024, height: 1024, nsfw: false, description: "Alibaba Qwen-Image — detailed, artistic, multi-style" },
];

// ─── FreeGPT image models (4 real AI generators, WASM-secured, no key) ──────
// Removed: freegpt-grok-imagine (unreliable / broken upstream)
const FREEGPT_MODELS: ImageModel[] = [
  { id: "freegpt-gpt-image-2", name: "GPT-Image 2 (FreeGPT)", provider: "freegpt", category: "general", upstreamModel: "gpt-image-2", width: 1024, height: 1024, nsfw: false, description: "OpenAI GPT-Image 2 via FreeGPT.tech — high-quality generation" },
  { id: "freegpt-nano-banana-2", name: "Nano Banana 2 (FreeGPT)", provider: "freegpt", category: "realism", upstreamModel: "nano-banana-2", width: 1024, height: 1024, nsfw: false, description: "Google Gemini Nano Banana 2 via FreeGPT.tech — photorealistic" },
  { id: "freegpt-flux-2-flex", name: "Flux 2 Flex (FreeGPT)", provider: "freegpt", category: "realism", upstreamModel: "flux-2-flex", width: 1024, height: 1024, nsfw: false, description: "Black Forest Labs Flux 2 Flex via FreeGPT.tech — photorealistic" },
  { id: "freegpt-gemini-flash-image", name: "Gemini Flash Image (FreeGPT)", provider: "freegpt", category: "general", upstreamModel: "gemini-3.1-flash-image", width: 1024, height: 1024, nsfw: false, description: "Google Gemini 3.1 Flash Image via FreeGPT.tech — fast, high-quality" },
];

// ─── FreepikAI image models (6 styles, 4MP, Turnstile-verified) ─────────────
// Uses Cloudflare Turnstile for bot verification. Each request uses a unique
// UUID session to maximize rate limits. Styles map to the FreepikAI API.
const FREEPIKAI_MODELS: ImageModel[] = [
  { id: "fpk-photorealistic", name: "Photorealistic (FreepikAI)", provider: "freepikai", category: "realism", upstreamModel: "Photorealistic", width: 1024, height: 1024, nsfw: false, description: "FreepikAI Photorealistic — 4MP ultra-HD photorealistic generation" },
  { id: "fpk-digital-art", name: "Digital Art (FreepikAI)", provider: "freepikai", category: "mixed", upstreamModel: "Digital Art", width: 1024, height: 1024, nsfw: false, description: "FreepikAI Digital Art — 4MP stylized digital art generation" },
  { id: "fpk-oil-painting", name: "Oil Painting (FreepikAI)", provider: "freepikai", category: "mixed", upstreamModel: "Oil Painting", width: 1024, height: 1024, nsfw: false, description: "FreepikAI Oil Painting — 4MP classic oil painting style" },
  { id: "fpk-anime", name: "Anime (FreepikAI)", provider: "freepikai", category: "anime", upstreamModel: "Anime", width: 1024, height: 1024, nsfw: false, description: "FreepikAI Anime — 4MP anime / illustration style" },
  { id: "fpk-3d-render", name: "3D Render (FreepikAI)", provider: "freepikai", category: "mixed", upstreamModel: "3D Render", width: 1024, height: 1024, nsfw: false, description: "FreepikAI 3D Render — 4MP 3D rendered imagery" },
  { id: "fpk-watercolor", name: "Watercolor (FreepikAI)", provider: "freepikai", category: "mixed", upstreamModel: "Watercolor", width: 1024, height: 1024, nsfw: false, description: "FreepikAI Watercolor — 4MP watercolor painting style" },
];

const FREEGEN_MODELS: ImageModel[] = [
  { id: "freegen-default", name: "FreeGen Default", provider: "freegen", category: "mixed", upstreamModel: "default", width: 1024, height: 1024, nsfw: false, description: "FreeGen AI Image Generation — WebSocket task queue, multiple aspect ratios" },
];

// ─── AIAnime models (api.aianime.io, IP rotation for rate limit bypass) ──────
const AIANIME_MODELS: ImageModel[] = [
  { id: "aianime-text2image", name: "AIAnime Text2Image", provider: "aianime", category: "anime", upstreamModel: "text2image", width: 1024, height: 1024, nsfw: false, description: "AIAnime Text-to-Image via api.aianime.io — anime/illustration focused, IP rotation for rate limit bypass" },
];

export const IMAGE_MODELS: readonly ImageModel[] = [
  ...POLL_MODELS,
  ...FREEGPT_MODELS,
  ...FREEPIKAI_MODELS,
  ...FREEGEN_MODELS,
  ...AIANIME_MODELS,
];

/** Quick lookup by id. */
export function findImageModel(id: string): ImageModel | undefined {
  return IMAGE_MODELS.find((m) => m.id === id);
}

/** Count by category. */
export function imageModelCounts(): Record<ImageCategory, number> {
  const counts: Record<ImageCategory, number> = {
    anime: 0, realism: 0, mixed: 0, general: 0,
    "unrestricted-anime": 0, "unrestricted-realism": 0, "unrestricted-mixed": 0,
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
    description: "5 real AI image generation models (Flux, Turbo, Dreamshaper, GPT-Image, Qwen-Image). Unlimited, free, no signup, instant (~0.3-1s per image).",
  },
  freegpt: {
    name: "FreeGPT.tech",
    description: "4 real AI image models (GPT-Image 2, Nano Banana 2, Flux 2 Flex, Gemini Flash Image) via FreeGPT.tech's WASM-secured endpoint. No key needed.",
  },
  freepikai: {
    name: "FreepikAI",
    description: "6 style models (Photorealistic, Digital Art, Oil Painting, Anime, 3D Render, Watercolor) via FreepikAI.net. 4MP ultra-HD resolution, Turnstile-verified, UUID-per-request for high rate limits.",
  },
  freegen: {
    name: "FreeGen",
    description: "AI Image Generation via FreeGen task queue with WebSocket bridge. Prompt signing, multiple aspect ratios, no API key required.",
  },
  aianime: {
    name: "AIAnime",
    description: "Text-to-Image generation via api.aianime.io. Anime/illustration focused with automatic IP rotation for rate limit bypass. Returns job_id for async polling.",
  },
};

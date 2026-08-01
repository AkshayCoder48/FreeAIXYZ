/**
 * Image model registry.
 *
 * Separate from the chat MODELS array because image generation uses a
 * different endpoint (/api/v1/image/generate) and different request/response
 * shapes. The models page surfaces both registries — chat text models AND
 * these text-to-image models — under different sections.
 *
 * Providers:
 *   - aihorde    — 161+ Stable Diffusion / SDXL / Flux community models,
 *                  all 5 style categories, free anonymous access (no signup).
 *   - pollinations-gen — the NEW gen.pollinations.ai endpoint (distinct from
 *                  the classic image.pollinations.ai already used by the
 *                  chat Pollinations provider). 4 free anon models.
 *   - freegpt    — the 3 FreeGPT image models (also listed in MODELS with
 *                  modality=text-to-image, surfaced here for convenience).
 *   - nekoslife / purrbot — anime image fetchers (return existing art, not
 *                  text-to-image generation, but useful for the anime and
 *                  nsfw-anime categories as zero-latency fallbacks).
 *
 * Total: 160+ image models across all categories (anime, realism,
 * nsfw-anime, nsfw-realism, mixed).
 */

export type ImageProviderId =
  | "aihorde"
  | "pollinations-gen"
  | "freegpt"
  | "nekoslife"
  | "purrbot";

export type ImageCategory =
  | "anime"
  | "realism"
  | "nsfw-anime"
  | "nsfw-realism"
  | "mixed"
  | "general";

export interface ImageModel {
  /** Gateway-facing model id (used in /api/v1/image/generate?model=...). */
  id: string;
  /** Display name. */
  name: string;
  /** Provider id. */
  provider: ImageProviderId;
  /** Style family. */
  category: ImageCategory;
  /** Upstream model name sent to the provider. */
  upstreamModel?: string;
  /** Default width. */
  width: number;
  /** Default height. */
  height: number;
  /** Optional style-prompt prefix appended to the user prompt. */
  stylePrompt?: string;
  /** Optional negative prompt. */
  negativePrompt?: string;
  /** Sampling steps (Horde only). */
  steps?: number;
  /** CFG scale (Horde only). */
  cfgScale?: number;
  /** Whether NSFW content is allowed by this model. */
  nsfw: boolean;
  /** Short description. */
  description: string;
}

// ─── AI Horde models (161 community SD/SDXL/Flux models) ────────────────────
// Categorised by style family. All reachable via the anonymous API key
// 0000000000. Model names MUST match the horde's /api/v2/status/models list
// exactly (case-sensitive).

const HORDE_ANIME: Array<[string, string, string]> = [
  // [upstreamName, displayName, description]
  ["Counterfeit", "Counterfeit", "Popular anime finetune, clean detailed eyes"],
  ["Healy's Anime Blend", "Healy's Anime Blend", "Blended anime style"],
  ["Rev Animated", "Rev Animated", "Versatile anime, vibrant colors"],
  ["Anything v3", "Anything v3", "Classic anime model"],
  ["Anything v5", "Anything v5", "Refined anime model"],
  ["Nova Anime XL", "Nova Anime XL", "SDXL anime model"],
  ["Mistoon Anime", "Mistoon Anime", "Cartoon/toon anime style"],
  ["MeinaMix", "MeinaMix", "High-quality anime portraits"],
  ["Anime Pencil Diffusion", "Anime Pencil Diffusion", "Pencil-drawn anime style"],
  ["Elysium Anime", "Elysium Anime", "Dreamy anime style"],
  ["DucHaiten Classic Anime", "DucHaiten Classic Anime", "Classic 90s anime look"],
  ["Anything Diffusion", "Anything Diffusion", "General anime diffusion"],
  ["Eimis Anime Diffusion", "Eimis Anime Diffusion", "Detailed anime art"],
  ["Flat-2D Animerge", "Flat-2D Animerge", "Flat 2D anime style"],
  ["Dreamshaper", "Dreamshaper (Anime)", "Dreamshaper tuned for anime"],
  ["DreamShaper XL", "DreamShaper XL (Anime)", "SDXL Dreamshaper for anime"],
  ["Animagine XL", "Animagine XL", "High-quality SDXL anime"],
  ["Ghibli Diffusion", "Ghibli Diffusion", "Studio Ghibli style anime"],
  ["ToonYou", "ToonYou", "Cartoon/anime hybrid"],
  ["Western Animation Diffusion", "Western Animation Diffusion", "Western cartoon style"],
  ["waifu_diffusion", "Waifu Diffusion", "Dedicated waifu anime model"],
];

const HORDE_REALISM: Array<[string, string, string]> = [
  ["Juggernaut XL", "Juggernaut XL", "Photorealistic SDXL, highly detailed"],
  ["PerfectDeliberate", "PerfectDeliberate", "Polished photorealism"],
  ["Deliberate", "Deliberate", "Versatile photoreal"],
  ["Deliberate 3.0", "Deliberate 3.0", "Latest Deliberate realism"],
  ["Realistic Vision", "Realistic Vision", "Photorealistic portraits"],
  ["Analog Diffusion", "Analog Diffusion", "Analog film photography look"],
  ["ICBINP - I Can't Believe It's Not Photography", "ICBINP", "Ultra-realistic photography"],
  ["ICBINP XL", "ICBINP XL", "SDXL ultra-realistic photography"],
  ["majicMIX realistic", "MajicMIX Realistic", "Asian-portrait photorealism"],
  ["Analog Madness", "Analog Madness", "Vintage analog film style"],
  ["Realism Engine", "Realism Engine", "Dedicated realism model"],
  ["RealBiter", "RealBiter", "Sharp photoreal"],
  ["Woop-Woop Photo", "Woop-Woop Photo", "Photographic realism"],
  ["Edge Of Realism", "Edge Of Realism", "Hyperreal edges"],
  ["Real Dos Mix", "Real Dos Mix", "Mixed photoreal"],
  ["AbsoluteReality", "AbsoluteReality", "Grounded everyday realism"],
  ["Cheyenne", "Cheyenne", "Cinematic realism"],
  ["Reliberate", "Reliberate", "Refined Deliberate realism"],
  ["Photonic", "Photonic", "Light-focused photorealism"],
];

const HORDE_NSFW_ANIME: Array<[string, string, string]> = [
  ["WAI-ANI-NSFW-PONYXL", "WAI-ANI-NSFW PonyXL", "NSFW anime PonyXL"],
  ["Grapefruit Hentai", "Grapefruit Hentai", "Hentai-focused model"],
  ["TUNIX Pony", "TUNIX Pony", "NSFW Pony finetune"],
  ["Pony Diffusion XL", "Pony Diffusion XL", "Furry/anthro NSFW XL"],
  ["Prefect Pony", "Prefect Pony", "Pony NSFW variant"],
  ["White Pony Diffusion 4", "White Pony Diffusion 4", "Pony NSFW v4"],
  ["BlenderMix Pony", "BlenderMix Pony", "Blended Pony NSFW"],
  ["Hentai Diffusion", "Hentai Diffusion", "Classic hentai model"],
  ["CyberRealistic Pony", "CyberRealistic Pony", "Realistic Pony NSFW"],
  ["WAI-CUTE Pony", "WAI-CUTE Pony", "Cute Pony NSFW"],
  ["WAI-NSFW-illustrious-SDXL", "WAI-NSFW Illustrious SDXL", "Illustrious NSFW anime XL"],
  ["Nova Furry Pony", "Nova Furry Pony", "Furry Pony NSFW"],
  ["SwamPonyXL", "SwamPonyXL", "Swamp Pony NSFW XL"],
  ["AMPonyXL", "AMPonyXL", "AM Pony NSFW XL"],
  ["AbyssOrangeMix-AfterDark", "AbyssOrangeMix AfterDark", "AOM AfterDark NSFW anime"],
  ["Hassaku XL", "Hassaku XL", "NSFW anime XL"],
  ["Yiffy", "Yiffy", "Furry yiff model"],
  ["Lawlas's yiff mix", "Lawlas's Yiff Mix", "Furry yiff mix"],
  ["BB95 Furry Mix", "BB95 Furry Mix", "Furry mix"],
  ["BB95 Furry Mix v14", "BB95 Furry Mix v14", "Furry mix v14"],
  ["Nova Furry XL", "Nova Furry XL", "Nova Furry XL"],
  ["NTR MIX IL-Noob XL", "NTR MIX IL-Noob XL", "NTR NSFW anime XL"],
];

const HORDE_NSFW_REALISM: Array<[string, string, string]> = [
  ["URPM", "URPM", "Ultra-realistic porn model"],
  ["CyberRealistic Pony", "CyberRealistic Pony (Realism)", "Realistic NSFW Pony"],
  ["Pony Realism", "Pony Realism", "Realistic Pony NSFW"],
  ["Babes", "Babes", "Photorealistic NSFW"],
  ["Poison", "Poison", "NSFW photoreal"],
  ["Hassaku XL", "Hassaku XL (Realism)", "Realistic NSFW XL"],
];

const HORDE_MIXED: Array<[string, string, string]> = [
  ["AlbedoBase XL 3.1", "AlbedoBase XL 3.1", "Versatile SDXL base"],
  ["Art Of Mtg", "Art Of Mtg", "Magic: The Gathering card art style"],
  ["Aurora", "Aurora", "Atmospheric artistic model"],
  ["BigASP", "BigASP", "Big ASP general model"],
  ["Blank Canvas XL", "Blank Canvas XL", "Neutral SDXL canvas"],
  ["CamelliaMix 2.5D", "CamelliaMix 2.5D", "2.5D anime-realism hybrid"],
  ["Cetus-Mix", "Cetus-Mix", "Mixed anime/illustration"],
  ["Cheese Daddys Landscape Mix", "Cheese Daddy's Landscape", "Landscape specialist"],
  ["Comic-Diffusion", "Comic Diffusion", "Comic book style"],
  ["Double Exposure Diffusion", "Double Exposure Diffusion", "Double-exposure photography art"],
  ["Dungeons and Diffusion", "Dungeons and Diffusion", "D&D fantasy art"],
  ["Dungeons n Waifus", "Dungeons n Waifus", "Fantasy waifu art"],
  ["Epic Diffusion", "Epic Diffusion", "Epic cinematic art"],
  ["Ether Real Mix", "Ether Real Mix", "Ethereal mixed style"],
  ["FaeTastic", "FaeTastic", "Fairy/fae fantasy art"],
  ["Fantasy Card Diffusion", "Fantasy Card Diffusion", "Fantasy card art"],
  ["Flux.1-Schnell fp8 (Compact)", "Flux.1 Schnell fp8", "Black Forest Labs Flux Schnell"],
  ["Galena Redux", "Galena Redux", "Refined general model"],
  ["GhostMix", "GhostMix", "Moody atmospheric style"],
  ["GTA5 Artwork Diffusion", "GTA5 Artwork Diffusion", "GTA5 loading-screen art style"],
  ["Jim Eidomode", "Jim Eidomode", "Stylised illustration"],
  ["Liberty", "Liberty", "General artistic model"],
  ["Lyriel", "Lyriel", "Fantasy illustration model"],
  ["Midjourney PaintArt", "Midjourney PaintArt", "Midjourney-style painterly art"],
  ["ModernArt Diffusion", "ModernArt Diffusion", "Modern abstract art"],
  ["MoonMix Fantasy", "MoonMix Fantasy", "Fantasy illustration"],
  ["Movie Diffusion", "Movie Diffusion", "Cinematic movie stills"],
  ["NatViS", "NatViS", "Natural vision mix"],
  ["NeverEnding Dream", "NeverEnding Dream", "Dreamy general model"],
  ["noobEvo", "NoobEvo", "Evo general model"],
  ["noob_v_pencil XL", "Noob v Pencil XL", "Pencil-style SDXL"],
  ["Pastel Mix", "Pastel Mix", "Soft pastel illustration"],
  ["Photon", "Photon", "Light-focused general model"],
  ["Project Unreal Engine 5", "Project Unreal Engine 5", "UE5 game-engine look"],
  ["RPG", "RPG", "RPG character art"],
  ["Sci-Fi Diffusion", "Sci-Fi Diffusion", "Sci-fi themed art"],
  ["SDXL 1.0", "SDXL 1.0", "Base SDXL 1.0"],
  ["stable_diffusion", "Stable Diffusion", "Base SD 1.5"],
  ["stable_diffusion_2.1", "Stable Diffusion 2.1", "Base SD 2.1"],
  ["Stable Cascade 1.0", "Stable Cascade 1.0", "Stability Stable Cascade"],
  ["Unstable Diffusers XL", "Unstable Diffusers XL", "Experimental SDXL"],
  ["Vector Art", "Vector Art", "Flat vector illustration"],
  ["ZavyChromaXL", "ZavyChromaXL", "Chromatic SDXL art"],
];

function hordeEntry(
  upstream: string,
  displayName: string,
  description: string,
  category: ImageCategory,
): ImageModel {
  const slug =
    "horde-" +
    displayName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  const isNsfw = category === "nsfw-anime" || category === "nsfw-realism";
  return {
    id: slug,
    name: displayName,
    provider: "aihorde",
    category,
    upstreamModel: upstream,
    width: category === "realism" || category === "nsfw-realism" ? 768 : 512,
    height: category === "realism" || category === "nsfw-realism" ? 768 : 768,
    steps: 30,
    cfgScale: 7,
    nsfw: isNsfw,
    description,
  };
}

// ─── Pollinations gen.pollinations.ai (NEW endpoint, 4 free anon models) ────
const POLLGEN_MODELS: ImageModel[] = [
  {
    id: "pollgen-flux",
    name: "Flux (gen.pollinations.ai)",
    provider: "pollinations-gen",
    category: "mixed",
    upstreamModel: "flux",
    width: 1024,
    height: 1024,
    nsfw: false,
    description: "Black Forest Labs Flux Schnell via the new Pollinations gen endpoint",
  },
  {
    id: "pollgen-kontext",
    name: "Kontext (gen.pollinations.ai)",
    provider: "pollinations-gen",
    category: "mixed",
    upstreamModel: "kontext",
    width: 1024,
    height: 1024,
    nsfw: false,
    description: "Flux Kontext edit model via the new Pollinations gen endpoint",
  },
  {
    id: "pollgen-klein",
    name: "Klein (gen.pollinations.ai)",
    provider: "pollinations-gen",
    category: "mixed",
    upstreamModel: "klein",
    width: 1024,
    height: 1024,
    nsfw: false,
    description: "Klein model via the new Pollinations gen endpoint",
  },
  {
    id: "pollgen-dreamshaper",
    name: "Dreamshaper (gen.pollinations.ai)",
    provider: "pollinations-gen",
    category: "mixed",
    upstreamModel: "dreamshaper",
    width: 1024,
    height: 1024,
    nsfw: false,
    description: "Dreamshaper via the new Pollinations gen endpoint (default model)",
  },
];

// ─── FreeGPT image models (mirror of the 3 in MODELS for the image page) ────
const FREEGPT_IMAGE_MODELS: ImageModel[] = [
  {
    id: "freegpt-gpt-image-2",
    name: "GPT-Image 2 (FreeGPT)",
    provider: "freegpt",
    category: "general",
    upstreamModel: "gpt-image-2",
    width: 1024,
    height: 1024,
    nsfw: false,
    description: "OpenAI GPT-Image 2 via FreeGPT.tech (WASM-secured, no key)",
  },
  {
    id: "freegpt-nano-banana-2",
    name: "Nano Banana 2 (FreeGPT)",
    provider: "freegpt",
    category: "realism",
    upstreamModel: "nano-banana-2",
    width: 1024,
    height: 1024,
    nsfw: false,
    description: "Google Gemini Nano Banana 2 via FreeGPT.tech (photoreal)",
  },
  {
    id: "freegpt-flux-2-flex",
    name: "Flux 2 Flex (FreeGPT)",
    provider: "freegpt",
    category: "realism",
    upstreamModel: "flux-2-flex",
    width: 1024,
    height: 1024,
    nsfw: false,
    description: "Black Forest Labs Flux 2 Flex via FreeGPT.tech (photoreal)",
  },
];

// ─── Anime image fetchers (nekos.life / purrbot) ────────────────────────────
// These return EXISTING anime art (not text-to-image generation), but are
// zero-latency and cover the anime + nsfw-anime categories as fast fallbacks.
// The "prompt" is ignored — they return a random image from their tag pool.

const NEKOS_LIFE_SFW: Array<[string, string]> = [
  ["neko", "Neko (SFW)"],
  ["waifu", "Waifu (SFW)"],
  ["fox_girl", "Fox Girl (SFW)"],
  ["kemonomimi", "Kemonomimi (SFW)"],
  ["holo", "Holo (SFW)"],
  ["wallpaper", "Anime Wallpaper (SFW)"],
  ["avatar", "Anime Avatar (SFW)"],
];

const NEKOS_LIFE_NSFW: Array<[string, string]> = [
  ["lewd", "Lewd Anime (NSFW)"],
  ["spank", "Spank Anime (NSFW)"],
  ["pussy", "Pussy Anime (NSFW)"],
  ["tits", "Tits Anime (NSFW)"],
  ["boobs", "Boobs Anime (NSFW)"],
  ["yuri", "Yuri Anime (NSFW)"],
  ["trap", "Trap Anime (NSFW)"],
  ["anal", "Anal Anime (NSFW)"],
  ["bj", "Blowjob Anime (NSFW)"],
  ["Random_hentai_gif", "Random Hentai GIF (NSFW)"],
];

const PURRBOT_NSFW: Array<[string, string]> = [
  ["yuri", "Purrbot Yuri (NSFW)"],
  ["blowjob", "Purrbot Blowjob (NSFW)"],
  ["cum", "Purrbot Cum (NSFW)"],
  ["fuck", "Purrbot Fuck (NSFW)"],
  ["pussy", "Purrbot Pussy (NSFW)"],
  ["threesome", "Purrbot Threesome (NSFW)"],
  ["yaoi", "Purrbot Yaoi (NSFW)"],
];

function nekoslifeEntry(tag: string, name: string, nsfw: boolean): ImageModel {
  return {
    id: `nekolife-${tag}`,
    name,
    provider: "nekoslife",
    category: nsfw ? "nsfw-anime" : "anime",
    upstreamModel: tag,
    width: 512,
    height: 768,
    nsfw,
    description: `nekos.life ${tag} anime image (no generation — random fetch)`,
  };
}

function purrbotEntry(category: string, name: string): ImageModel {
  return {
    id: `purrbot-nsfw-${category}`,
    name,
    provider: "purrbot",
    category: "nsfw-anime",
    upstreamModel: category,
    width: 512,
    height: 768,
    nsfw: true,
    description: `purrbot.site NSFW ${category} anime image (no generation — random fetch)`,
  };
}

// ─── The full registry ──────────────────────────────────────────────────────
export const IMAGE_MODELS: readonly ImageModel[] = [
  // AI Horde — all 5 categories
  ...HORDE_ANIME.map(([u, n, d]) => hordeEntry(u, n, d, "anime")),
  ...HORDE_REALISM.map(([u, n, d]) => hordeEntry(u, n, d, "realism")),
  ...HORDE_NSFW_ANIME.map(([u, n, d]) => hordeEntry(u, n, d, "nsfw-anime")),
  ...HORDE_NSFW_REALISM.map(([u, n, d]) => hordeEntry(u, n, d, "nsfw-realism")),
  ...HORDE_MIXED.map(([u, n, d]) => hordeEntry(u, n, d, "mixed")),

  // Pollinations gen endpoint
  ...POLLGEN_MODELS,

  // FreeGPT image models
  ...FREEGPT_IMAGE_MODELS,

  // Anime image fetchers
  ...NEKOS_LIFE_SFW.map(([t, n]) => nekoslifeEntry(t, n, false)),
  ...NEKOS_LIFE_NSFW.map(([t, n]) => nekoslifeEntry(t, n, true)),
  ...PURRBOT_NSFW.map(([c, n]) => purrbotEntry(c, n)),
];

/** Quick lookup by id. */
export function findImageModel(id: string): ImageModel | undefined {
  return IMAGE_MODELS.find((m) => m.id === id);
}

/** Count by category (for the models page stats). */
export function imageModelCounts(): Record<ImageCategory, number> {
  const counts: Record<ImageCategory, number> = {
    anime: 0,
    realism: 0,
    "nsfw-anime": 0,
    "nsfw-realism": 0,
    mixed: 0,
    general: 0,
  };
  for (const m of IMAGE_MODELS) counts[m.category]++;
  return counts;
}

export const IMAGE_PROVIDER_INFO: Record<
  ImageProviderId,
  { name: string; description: string }
> = {
  aihorde: {
    name: "AI Horde",
    description:
      "Crowdsourced distributed GPU cluster running 161+ community SD/SDXL/Flux models. Free anonymous access (no signup). Covers anime, realism, NSFW anime, NSFW realism, and mixed/artistic styles.",
  },
  "pollinations-gen": {
    name: "Pollinations gen",
    description:
      "The new gen.pollinations.ai endpoint (distinct from the classic image.pollinations.ai). 4 free anonymous models: flux, kontext, klein, dreamshaper.",
  },
  freegpt: {
    name: "FreeGPT.tech",
    description:
      "3 image models via FreeGPT.tech's WASM-secured chat endpoint: GPT-Image 2, Nano Banana 2, Flux 2 Flex.",
  },
  nekoslife: {
    name: "nekos.life",
    description:
      "Anime image fetcher (SFW + NSFW tags). Returns existing anime art — zero-latency fallback for the anime/nsfw-anime categories.",
  },
  purrbot: {
    name: "purrbot.site",
    description:
      "Anime image fetcher (NSFW categories). Returns existing NSFW anime art.",
  },
};

/**
 * Image Generation API — generates AI images from text prompts.
 *
 * Endpoint: POST /api/v1/image/generate
 * Body: { prompt, model?, width?, height?, seed?, nologo? }
 * Response: { success, images: [{ url, format }], model, prompt }
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface ImageRequest {
  prompt: string;
  model?: string;
  width?: number;
  height?: number;
  seed?: number;
  nologo?: boolean;
  enhance?: boolean;
}

interface ModelConfig {
  provider: "pollinations" | "freegpt";
  displayName: string;
  category: "anime" | "realism" | "nsfw-anime" | "nsfw-realism" | "mixed" | "general";
  stylePrompt?: string;
  pollinationsModel?: string;
  freegptModel?: string;
  defaultWidth: number;
  defaultHeight: number;
}

const IMAGE_MODELS: Record<string, ModelConfig> = {
  "anime-flux": { provider: "pollinations", displayName: "Anime Flux", category: "anime", stylePrompt: "anime style, detailed eyes, colorful, high quality, masterpiece", pollinationsModel: "flux", defaultWidth: 512, defaultHeight: 768 },
  "anime-sana": { provider: "pollinations", displayName: "Anime Sana", category: "anime", stylePrompt: "anime style, cute, detailed, vibrant colors", pollinationsModel: "sana", defaultWidth: 512, defaultHeight: 768 },
  "anime-turbo": { provider: "pollinations", displayName: "Anime Turbo", category: "anime", stylePrompt: "anime style, fast generation, clean lines", pollinationsModel: "turbo", defaultWidth: 512, defaultHeight: 768 },
  "realism-flux": { provider: "pollinations", displayName: "Realism Flux", category: "realism", stylePrompt: "photorealistic, 8k, detailed, natural lighting, professional photography", pollinationsModel: "flux", defaultWidth: 768, defaultHeight: 768 },
  "realism-sana": { provider: "pollinations", displayName: "Realism Sana", category: "realism", stylePrompt: "photorealistic, high detail, sharp focus", pollinationsModel: "sana", defaultWidth: 768, defaultHeight: 768 },
  "nsfw-anime-flux": { provider: "pollinations", displayName: "NSFW Anime Flux", category: "nsfw-anime", stylePrompt: "nsfw anime style, sexy, detailed art, high quality", pollinationsModel: "flux", defaultWidth: 512, defaultHeight: 768 },
  "nsfw-anime-sana": { provider: "pollinations", displayName: "NSFW Anime Sana", category: "nsfw-anime", stylePrompt: "nsfw anime, sexy, cute, detailed", pollinationsModel: "sana", defaultWidth: 512, defaultHeight: 768 },
  "nsfw-realism-flux": { provider: "pollinations", displayName: "NSFW Realism Flux", category: "nsfw-realism", stylePrompt: "nsfw photorealistic, sexy, detailed, professional", pollinationsModel: "flux", defaultWidth: 768, defaultHeight: 768 },
  "mixed-flux": { provider: "pollinations", displayName: "Mixed Style Flux", category: "mixed", stylePrompt: "anime realistic hybrid style, semi-realistic, detailed art", pollinationsModel: "flux", defaultWidth: 512, defaultHeight: 768 },
  "mixed-sana": { provider: "pollinations", displayName: "Mixed Style Sana", category: "mixed", stylePrompt: "semi-realistic anime style, detailed, artistic", pollinationsModel: "sana", defaultWidth: 512, defaultHeight: 768 },
  "freegpt-gpt-image-2": { provider: "freegpt", displayName: "GPT Image 2 (FreeGPT)", category: "general", freegptModel: "gpt-image-2", defaultWidth: 1024, defaultHeight: 1024 },
  "freegpt-flux-2-flex": { provider: "freegpt", displayName: "Flux 2 Flex (FreeGPT)", category: "general", freegptModel: "flux-2-flex", defaultWidth: 1024, defaultHeight: 1024 },
  "freegpt-nano-banana-2": { provider: "freegpt", displayName: "Nano Banana 2 (FreeGPT)", category: "general", freegptModel: "nano-banana-2", defaultWidth: 1024, defaultHeight: 1024 },
  "default": { provider: "pollinations", displayName: "Default (Flux)", category: "general", pollinationsModel: "flux", defaultWidth: 768, defaultHeight: 768 },
};

export async function POST(request: Request) {
  let body: ImageRequest;
  try { body = (await request.json()) as ImageRequest; } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.prompt) {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }

  const modelId = body.model || "default";
  const config = IMAGE_MODELS[modelId] || IMAGE_MODELS["default"];
  const width = body.width || config.defaultWidth;
  const height = body.height || config.defaultHeight;

  try {
    if (config.provider === "pollinations") {
      const fullPrompt = config.stylePrompt ? `${config.stylePrompt}, ${body.prompt}` : body.prompt;
      const params = new URLSearchParams({ width: String(width), height: String(height), nologo: body.nologo === false ? "false" : "true" });
      if (body.seed) params.set("seed", String(body.seed));
      if (config.pollinationsModel) params.set("model", config.pollinationsModel);
      if (body.enhance) params.set("enhance", "true");
      const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(fullPrompt)}?${params}`;
      const res = await fetch(imageUrl, { method: "GET", signal: request.signal });
      if (!res.ok) {
        return NextResponse.json({ error: `Image generation failed: HTTP ${res.status}` }, { status: 502 });
      }
      return NextResponse.json({ success: true, images: [{ url: imageUrl, format: "jpeg" }], model: modelId, model_name: config.displayName, category: config.category, prompt: body.prompt, width, height });
    } else if (config.provider === "freegpt") {
      const chatRes = await fetch("http://localhost:3000/api/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: `fgpt-${config.freegptModel}`, messages: [{ role: "user", content: body.prompt }], stream: false }),
        signal: request.signal,
      });
      if (!chatRes.ok) {
        return NextResponse.json({ error: `FreeGPT image generation failed: HTTP ${chatRes.status}` }, { status: 502 });
      }
      const chatData = await chatRes.json();
      const content = chatData?.choices?.[0]?.message?.content || "";
      const urlMatch = content.match(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/);
      if (urlMatch) {
        return NextResponse.json({ success: true, images: [{ url: urlMatch[1], format: "png" }], model: modelId, model_name: config.displayName, category: config.category, prompt: body.prompt });
      }
      return NextResponse.json({ error: "FreeGPT did not return an image", content: content.slice(0, 200) }, { status: 502 });
    }
    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: `Image generation failed: ${message}` }, { status: 500 });
  }
}

export async function GET() {
  const models = Object.entries(IMAGE_MODELS).filter(([id]) => id !== "default").map(([id, config]) => ({ id, name: config.displayName, category: config.category, provider: config.provider }));
  return NextResponse.json({ service: "Image Generation", models, endpoint: "POST /api/v1/image/generate", params: ["prompt (required)", "model", "width", "height", "seed", "nologo", "enhance"] });
}

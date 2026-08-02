/**
 * Image Generation API — REAL AI generators only, base models only.
 * No signup, no API key, no queues, instant.
 *
 * Providers:
 *   - pollinations-gen — image.pollinations.ai (6 models, unlimited)
 *   - freegpt          — FreeGPT.tech image models (5 models)
 *
 * Endpoint: POST /api/v1/image/generate
 * Body: { prompt, model?, width?, height?, seed?, nologo?, nsfw? }
 */

import { NextResponse } from "next/server";
import {
  IMAGE_MODELS,
  findImageModel,
  type ImageModel,
} from "@/lib/providers/image-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface ImageRequest {
  prompt?: string;
  model?: string;
  width?: number;
  height?: number;
  seed?: number;
  nologo?: boolean;
  enhance?: boolean;
  nsfw?: boolean;
}

const DEFAULT_MODEL_ID = "poll-flux";

async function handlePollinations(model: ImageModel, req: ImageRequest, signal?: AbortSignal) {
  const width = req.width || model.width;
  const height = req.height || model.height;
  const prompt = req.prompt || "";
  const params = new URLSearchParams({
    width: String(width),
    height: String(height),
    nologo: req.nologo === false ? "false" : "true",
  });
  if (req.seed) params.set("seed", String(req.seed));
  if (model.upstreamModel) params.set("model", model.upstreamModel);
  if (req.enhance) params.set("enhance", "true");
  const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params}`;
  // Probe the URL to surface real errors
  const probe = await fetch(imageUrl, { method: "GET", signal });
  if (!probe.ok) {
    return NextResponse.json(
      { error: `Pollinations returned HTTP ${probe.status} for model ${model.upstreamModel}.` },
      { status: 502 },
    );
  }
  return NextResponse.json({
    success: true,
    images: [{ url: imageUrl, format: "jpeg" }],
    model: model.id,
    model_name: model.name,
    category: model.category,
    provider: "pollinations-gen",
    prompt: req.prompt,
    width, height,
  });
}

async function handleFreeGpt(model: ImageModel, req: ImageRequest, origin: string, signal?: AbortSignal) {
  const chatRes = await fetch(`${origin}/api/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: `fgpt-${model.upstreamModel}`,
      messages: [{ role: "user", content: req.prompt || "" }],
      stream: false,
    }),
    signal,
  });
  if (!chatRes.ok) {
    const errText = await chatRes.text().catch(() => "");
    return NextResponse.json(
      { error: `FreeGPT image generation failed: HTTP ${chatRes.status}`, detail: errText.slice(0, 300) },
      { status: 502 },
    );
  }
  const chatData = await chatRes.json();
  const content: string = chatData?.choices?.[0]?.message?.content || "";
  // Look for markdown image link OR raw URL
  const mdMatch = content.match(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/);
  const urlMatch = content.match(/(https?:\/\/[^\s"'<>)]+\.(?:png|jpg|jpeg|webp))/i);
  const imageUrl = mdMatch?.[1] || urlMatch?.[1];
  if (!imageUrl) {
    return NextResponse.json(
      { error: "FreeGPT did not return an image URL", content_preview: content.slice(0, 400) },
      { status: 502 },
    );
  }
  return NextResponse.json({
    success: true,
    images: [{ url: imageUrl, format: "png" }],
    model: model.id,
    model_name: model.name,
    category: model.category,
    provider: "freegpt",
    prompt: req.prompt,
  });
}

export async function POST(request: Request) {
  let body: ImageRequest;
  try { body = (await request.json()) as ImageRequest; } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.prompt) return NextResponse.json({ error: "prompt is required" }, { status: 400 });

  const modelId = body.model || DEFAULT_MODEL_ID;
  const model = findImageModel(modelId);
  if (!model) {
    return NextResponse.json(
      { error: `Unknown image model "${modelId}". Call GET /api/v1/image/generate for the list.` },
      { status: 400 },
    );
  }

  // NSFW consent gate
  if ((model.category === "nsfw-anime" || model.category === "nsfw-realism" || model.category === "nsfw-mixed") && body.nsfw !== true) {
    return NextResponse.json({
      error: 'This model is NSFW. Pass "nsfw": true in the request body to confirm you are 18+ and consent to adult content.',
      model: modelId, category: model.category,
    }, { status: 403 });
  }

  const origin = new URL(request.url).origin;
  try {
    switch (model.provider) {
      case "pollinations-gen": return await handlePollinations(model, body, request.signal);
      case "freegpt": return await handleFreeGpt(model, body, origin, request.signal);
      default: return NextResponse.json({ error: `Provider ${model.provider} not implemented` }, { status: 400 });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: `Image generation failed: ${message}`, model: modelId }, { status: 500 });
  }
}

export async function GET() {
  const models = IMAGE_MODELS.map((m) => ({
    id: m.id, name: m.name, category: m.category, provider: m.provider, nsfw: m.nsfw,
    upstream_model: m.upstreamModel, description: m.description,
    default_width: m.width, default_height: m.height,
  }));
  return NextResponse.json({
    service: "Image Generation", total_models: models.length,
    endpoint: "POST /api/v1/image/generate",
    params: ["prompt (required)", "model", "width", "height", "seed", "nologo", "nsfw (true for NSFW, 18+)"],
    categories: ["anime", "realism", "mixed", "general", "nsfw-anime", "nsfw-realism", "nsfw-mixed"],
    providers: "All providers are 100% free, no signup, no API key, instant (no queues). REAL AI generators only.",
    models,
  });
}

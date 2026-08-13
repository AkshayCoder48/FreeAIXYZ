/**
 * Image Generation API — REAL AI generators only, base models only.
 * No signup, no API key, no queues, instant.
 *
 * Providers:
 *   - pollinations-gen — image.pollinations.ai (1 model, unlimited)
 *   - freegpt          — FreeGPT.tech image models (4 models)
 *   - casper-tech      — Casper Technology via apis.xcasper.space (2 models, GET API)
 *
 * Endpoint: POST /api/v1/image/generate
 * Body: { prompt, model?, width?, height?, seed?, nologo?, nsfw? }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  IMAGE_MODELS,
  findImageModel,
  CASPER_BASE_URL,
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

// ─── Pollinations handler ────────────────────────────────────────────────────

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

// ─── FreeGPT handler (NO fallback — surface real errors) ────────────────────

async function handleFreeGpt(model: ImageModel, req: ImageRequest, origin: string, signal?: AbortSignal) {
  const MAX_RETRIES = 2;
  let lastError: string = "";

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = attempt * 1000;
      await new Promise((r) => setTimeout(r, delay));
    }

    try {
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
        lastError = `FreeGPT image generation failed: HTTP ${chatRes.status} — ${errText.slice(0, 200)}`;
        // Don't retry client errors (400/401/429)
        if (chatRes.status === 400 || chatRes.status === 401 || chatRes.status === 429) {
          break;
        }
        continue;
      }

      const chatData = await chatRes.json();
      const content: string = chatData?.choices?.[0]?.message?.content || "";

      // Look for markdown image link OR raw URL
      const mdMatch = content.match(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/);
      const urlMatch = content.match(/(https?:\/\/[^\s"'<>)]+\.(?:png|jpg|jpeg|webp))/i);
      const imageUrl = mdMatch?.[1] || urlMatch?.[1];

      if (!imageUrl) {
        lastError = `FreeGPT did not return an image URL. Content preview: ${content.slice(0, 200)}`;
        continue;
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
    } catch (e) {
      lastError = e instanceof Error ? e.message : "Unknown error during FreeGPT image generation";
      if (signal?.aborted) break;
      continue;
    }
  }

  // Return the real error — no silent fallback to Pollinations
  return NextResponse.json(
    { error: `FreeGPT image generation failed after ${MAX_RETRIES + 1} attempts`, detail: lastError },
    { status: 502 },
  );
}

// ─── Casper Tech handler (GET API with query params) ────────────────────────

async function handleCasperTech(model: ImageModel, req: ImageRequest, signal?: AbortSignal) {
  const prompt = req.prompt || "";
  const width = req.width || model.width;
  const height = req.height || model.height;

  // Casper Tech uses GET with query parameters on apis.xcasper.space
  // pollinations-image: GET /api/ai/pollinations-image?prompt=X&model=flux&width=W&height=H
  // magicstudio:       GET /api/ai/magicstudio?prompt=X
  const endpoint = model.upstreamModel === "magicstudio"
    ? `${CASPER_BASE_URL}/api/ai/magicstudio`
    : `${CASPER_BASE_URL}/api/ai/pollinations-image`;

  const params = new URLSearchParams({ prompt });
  if (model.upstreamModel === "pollinations-image") {
    params.set("model", "flux");
    params.set("width", String(width));
    params.set("height", String(height));
  }

  try {
    const res = await fetch(`${endpoint}?${params}`, {
      method: "GET",
      signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `Casper Tech returned HTTP ${res.status}: ${errText.slice(0, 300)}` },
        { status: 502 },
      );
    }

    const data = await res.json();

    // Casper Tech returns: { success, image_url, model, seed, width, height, ... }
    const imageUrl =
      data?.image_url ||
      data?.url ||
      data?.output ||
      (Array.isArray(data?.images) ? data.images[0]?.url : null) ||
      (Array.isArray(data?.output) ? data.output[0] : null);

    if (!imageUrl) {
      return NextResponse.json(
        { error: "Casper Tech did not return a valid image URL", raw_response: JSON.stringify(data).slice(0, 500) },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: true,
      images: [{ url: imageUrl, format: "png" }],
      model: model.id,
      model_name: model.name,
      category: model.category,
      provider: "casper-tech",
      prompt: req.prompt,
      width: data?.width ?? width,
      height: data?.height ?? height,
      seed: data?.seed,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error during Casper Tech image generation";
    return NextResponse.json(
      { error: `Casper Tech image generation failed: ${message}` },
      { status: 502 },
    );
  }
}

// ─── Route handlers ──────────────────────────────────────────────────────────

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

  const origin = new URL(request.url).origin;
  try {
    switch (model.provider) {
      case "pollinations-gen": return await handlePollinations(model, body, request.signal);
      case "freegpt": return await handleFreeGpt(model, body, origin, request.signal);
      case "casper-tech": return await handleCasperTech(model, body, request.signal);
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
    params: ["prompt (required)", "model", "width", "height", "seed", "nologo", "nsfw"],
    categories: ["anime", "realism", "mixed", "general"],
    providers: "All providers are 100% free, no signup, no API key.",
    models,
  });
}

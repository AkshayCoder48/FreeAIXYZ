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
        // Don't retry client errors (400/401/403/429) — 403 means FreeGPT is blocked
        if (chatRes.status === 400 || chatRes.status === 401 || chatRes.status === 403 || chatRes.status === 429) {
          // Surface a clearer message for 403
          if (chatRes.status === 403) {
            lastError = "FreeGPT is currently blocked (HTTP 403 Forbidden). This is a server-side restriction. Try again later or use a different provider (Pollinations or Casper Tech).";
          }
          break;
        }
        continue;
      }

      const chatData = await chatRes.json();
      const content: string = chatData?.choices?.[0]?.message?.content || "";

      // Try multiple patterns to extract an image URL from the response:
      // 1. Markdown image link: ![alt](url)
      // 2. URL with image extension: .png/.jpg/.jpeg/.webp/.gif
      // 3. Pollinations image URL (no extension)
      // 4. Any URL on common image CDNs
      // 5. Base64 data URI
      const mdMatch = content.match(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/);
      const extMatch = content.match(/(https?:\/\/[^\s"'<>)]+\.(?:png|jpg|jpeg|webp|gif))/i);
      const pollMatch = content.match(/(https?:\/\/image\.pollinations\.ai\/[^\s"'<>)]+)/i);
      const cdnMatch = content.match(/(https?:\/\/[^\s"'<>)]+(?:imgur|unsplash|picsum|cdn|static|media|upload)\/[^\s"'<>)]+)/i);
      const b64Match = content.match(/(data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+)/i);
      // Generic URL fallback — any URL that looks like it could be an image
      const genericUrlMatch = content.match(/(https?:\/\/[^\s"'<>)]+)/i);
      const imageUrl = mdMatch?.[1] || extMatch?.[1] || pollMatch?.[1] || cdnMatch?.[1] || b64Match?.[1] || genericUrlMatch?.[1];

      if (!imageUrl) {
        lastError = `FreeGPT did not return an image URL. Content preview: ${content.slice(0, 300)}`;
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
    { error: `FreeGPT image generation failed after ${MAX_RETRIES + 1} attempts`, detail: lastError, suggestion: "Try using Pollinations (poll-flux) or Casper Tech (casper-flux) models instead." },
    { status: 502 },
  );
}

// ─── Casper Tech handler (GET API with query params) ────────────────────────

async function handleCasperTech(model: ImageModel, req: ImageRequest, signal?: AbortSignal) {
  const prompt = req.prompt || "";
  const width = req.width || model.width;
  const height = req.height || model.height;

  // Casper Tech uses GET with query parameters on apis.xcasper.space
  // Uses the pollinations-image endpoint with flux model:
  //   GET /api/ai/pollinations-image?prompt=X&model=flux&width=W&height=H
  const endpoint = `${CASPER_BASE_URL}/api/ai/pollinations-image`;

  const params = new URLSearchParams({ prompt });
  params.set("model", "flux");
  params.set("width", String(width));
  params.set("height", String(height));

  // Casper Tech can be slow — add an explicit 60s timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60_000);
  if (signal) {
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    const res = await fetch(`${endpoint}?${params}`, {
      method: "GET",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

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
      // If the API returned success:false, surface the error
      if (data?.success === false) {
        return NextResponse.json(
          { error: `Casper Tech generation failed: ${data?.error || "Unknown error"}`, detail: data?.details || "" },
          { status: 502 },
        );
      }
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
    clearTimeout(timeoutId);
    if (controller.signal.aborted && !signal?.aborted) {
      return NextResponse.json(
        { error: "Casper Tech image generation timed out after 60 seconds. Try a smaller image size or use Pollinations (poll-flux) instead." },
        { status: 504 },
      );
    }
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

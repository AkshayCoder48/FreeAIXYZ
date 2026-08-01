/**
 * Image Generation API — generates AI images from text prompts.
 *
 * Endpoint: POST /api/v1/image/generate
 * Body: {
 *   prompt: string,                 (required)
 *   model?: string,                 (default: "pollgen-flux")
 *   width?: number,
 *   height?: number,
 *   seed?: number,                  (pollinations only)
 *   nologo?: boolean,               (pollinations only)
 *   negative_prompt?: string,       (horde only)
 *   steps?: number,                 (horde only)
 *   cfg_scale?: number,             (horde only)
 *   nsfw?: boolean,                 (horde only — allow NSFW models)
 *   timeout?: number,               (horde poll timeout, ms, default 8min)
 * }
 *
 * Response: {
 *   success: true,
 *   images: [{ url, format }],
 *   model, model_name, category, provider,
 *   prompt, width, height,
 *   seed?, censored?, queue_note?
 * }
 *
 * Models: GET /api/v1/image/generate  →  { service, models, endpoint, params }
 *
 * Providers:
 *   - aihorde          — async submit→poll→fetch, 161+ models, anon key 0000000000
 *   - pollinations-gen — gen.pollinations.ai/image/{prompt}?model=...
 *   - freegpt          — routes through /api/v1/chat/completions (fgpt-* ids)
 *   - nekoslife        — GET nekos.life/api/v2/img/{tag}, returns existing anime art
 *   - purrbot          — GET api.purrbot.site/v2/img/nsfw/{cat}/img
 *   - pollinations     — (legacy) classic image.pollinations.ai/prompt/...
 */

import { NextResponse } from "next/server";
import {
  IMAGE_MODELS,
  findImageModel,
  type ImageModel,
} from "@/lib/providers/image-registry";
import { generateImage as hordeGenerate } from "@/lib/providers/aihorde";

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
  negative_prompt?: string;
  steps?: number;
  cfg_scale?: number;
  nsfw?: boolean;
}

const DEFAULT_MODEL_ID = "pollgen-flux";

/** Build a style-enhanced prompt for anime/realism/nsfw categories. */
function applyStyle(prompt: string, model: ImageModel): string {
  if (!model.stylePrompt) return prompt;
  return `${model.stylePrompt}, ${prompt}`;
}

// ─── Provider handlers ──────────────────────────────────────────────────────

async function handleHorde(
  model: ImageModel,
  req: ImageRequest,
  signal?: AbortSignal,
) {
  const width = req.width || model.width;
  const height = req.height || model.height;
  const result = await hordeGenerate({
    prompt: applyStyle(req.prompt || "", model),
    model: model.upstreamModel!,
    width,
    height,
    steps: req.steps ?? model.steps ?? 30,
    cfgScale: req.cfg_scale ?? model.cfgScale ?? 7,
    nsfw: req.nsfw ?? model.nsfw ?? true,
    negativePrompt: req.negative_prompt ?? model.negativePrompt,
    signal,
  });
  return NextResponse.json({
    success: true,
    images: [{ url: result.imageUrl, format: "webp" }],
    model: model.id,
    model_name: model.name,
    category: model.category,
    provider: "aihorde",
    prompt: req.prompt,
    width,
    height,
    seed: result.seed,
    censored: result.censored,
    upstream_model: result.model,
    queue_note:
      "AI Horde anonymous tier — wait depends on queue load. Set nsfw:true for uncensored NSFW models.",
  });
}

async function handlePollinationsGen(
  model: ImageModel,
  req: ImageRequest,
  signal?: AbortSignal,
) {
  const width = req.width || model.width;
  const height = req.height || model.height;
  const prompt = applyStyle(req.prompt || "", model);
  const params = new URLSearchParams({
    width: String(width),
    height: String(height),
    nologo: req.nologo === false ? "false" : "true",
  });
  if (req.seed) params.set("seed", String(req.seed));
  if (model.upstreamModel) params.set("model", model.upstreamModel);
  if (req.enhance) params.set("enhance", "true");
  // Use the classic image.pollinations.ai endpoint (confirmed working for
  // anonymous access). The newer gen.pollinations.ai endpoint now 401s on
  // most models without a pollen balance.
  const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(
    prompt,
  )}?${params}`;
  // Probe the URL so we surface a real error instead of a broken link
  const probe = await fetch(imageUrl, { method: "GET", signal });
  if (!probe.ok) {
    return NextResponse.json(
      {
        error: `Pollinations returned HTTP ${probe.status} for model ${model.upstreamModel}.`,
      },
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
    width,
    height,
  });
}

async function handleFreeGpt(
  model: ImageModel,
  req: ImageRequest,
  origin: string,
  signal?: AbortSignal,
) {
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
      {
        error: `FreeGPT image generation failed: HTTP ${chatRes.status}`,
        detail: errText.slice(0, 300),
      },
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
      {
        error: "FreeGPT did not return an image URL",
        content_preview: content.slice(0, 400),
      },
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

async function handleNekosLife(model: ImageModel, signal?: AbortSignal) {
  const res = await fetch(
    `https://nekos.life/api/v2/img/${model.upstreamModel}`,
    { signal },
  );
  if (!res.ok) {
    return NextResponse.json(
      { error: `nekos.life returned HTTP ${res.status}` },
      { status: 502 },
    );
  }
  const data = (await res.json()) as { url?: string };
  if (!data.url) {
    return NextResponse.json(
      { error: "nekos.life returned no url" },
      { status: 502 },
    );
  }
  return NextResponse.json({
    success: true,
    images: [{ url: data.url, format: "jpg" }],
    model: model.id,
    model_name: model.name,
    category: model.category,
    provider: "nekoslife",
    note: "Existing anime art (random fetch, prompt ignored)",
  });
}

async function handlePurrbot(model: ImageModel, signal?: AbortSignal) {
  const res = await fetch(
    `https://api.purrbot.site/v2/img/nsfw/${model.upstreamModel}/img`,
    { signal },
  );
  if (!res.ok) {
    return NextResponse.json(
      { error: `purrbot.site returned HTTP ${res.status}` },
      { status: 502 },
    );
  }
  const data = (await res.json()) as { link?: string };
  if (!data.link) {
    return NextResponse.json(
      { error: "purrbot.site returned no link" },
      { status: 502 },
    );
  }
  return NextResponse.json({
    success: true,
    images: [{ url: data.link, format: "jpg" }],
    model: model.id,
    model_name: model.name,
    category: model.category,
    provider: "purrbot",
    note: "Existing anime art (random fetch, prompt ignored)",
  });
}

// ─── Route handlers ─────────────────────────────────────────────────────────

export async function POST(request: Request) {
  let body: ImageRequest;
  try {
    body = (await request.json()) as ImageRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.prompt) {
    return NextResponse.json(
      { error: "prompt is required" },
      { status: 400 },
    );
  }

  const modelId = body.model || DEFAULT_MODEL_ID;
  const model = findImageModel(modelId);
  if (!model) {
    return NextResponse.json(
      {
        error: `Unknown image model "${modelId}". Call GET /api/v1/image/generate for the list.`,
      },
      { status: 400 },
    );
  }

  // Block NSFW models unless nsfw:true is explicitly passed
  if (
    (model.category === "nsfw-anime" || model.category === "nsfw-realism") &&
    body.nsfw !== true
  ) {
    return NextResponse.json(
      {
        error:
          'This model is NSFW. Pass "nsfw": true in the request body to confirm you are 18+ and consent to adult content.',
        model: modelId,
        category: model.category,
      },
      { status: 403 },
    );
  }

  const origin = new URL(request.url).origin;

  try {
    switch (model.provider) {
      case "aihorde":
        return await handleHorde(model, body, request.signal);
      case "pollinations-gen":
        return await handlePollinationsGen(model, body, request.signal);
      case "freegpt":
        return await handleFreeGpt(model, body, origin, request.signal);
      case "nekoslife":
        return await handleNekosLife(model, request.signal);
      case "purrbot":
        return await handlePurrbot(model, request.signal);
      default:
        return NextResponse.json(
          { error: `Provider ${model.provider} not implemented` },
          { status: 400 },
        );
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { error: `Image generation failed: ${message}`, model: modelId },
      { status: 500 },
    );
  }
}

export async function GET() {
  const models = IMAGE_MODELS.map((m) => ({
    id: m.id,
    name: m.name,
    category: m.category,
    provider: m.provider,
    nsfw: m.nsfw,
    upstream_model: m.upstreamModel,
    description: m.description,
    default_width: m.width,
    default_height: m.height,
  }));
  return NextResponse.json({
    service: "Image Generation",
    total_models: models.length,
    endpoint: "POST /api/v1/image/generate",
    params: [
      "prompt (required)",
      "model",
      "width",
      "height",
      "seed (pollinations only)",
      "nologo (pollinations only)",
      "negative_prompt (horde only)",
      "steps (horde only, default 30)",
      "cfg_scale (horde only, default 7)",
      "nsfw (true to unlock NSFW models — 18+ only)",
    ],
    categories: [
      "anime",
      "realism",
      "nsfw-anime",
      "nsfw-realism",
      "mixed",
      "general",
    ],
    models,
  });
}

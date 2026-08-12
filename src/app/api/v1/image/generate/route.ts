/**
 * Image Generation API — REAL AI generators only, base models only.
 * No signup, no API key, no queues, instant.
 *
 * Providers:
 *   - pollinations-gen — image.pollinations.ai (5 models, unlimited)
 *   - freegpt          — FreeGPT.tech image models (4 models)
 *   - freepikai        — FreepikAI.net 4MP image gen (6 style models, Turnstile-verified)
 *   - freegen          — FreeGen WebSocket task queue (1 model, 7 aspect ratios)
 *
 * Endpoint: POST /api/v1/image/generate
 * Body: { prompt, model?, width?, height?, seed?, nologo?, nsfw?, size? }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  IMAGE_MODELS,
  findImageModel,
  type ImageModel,
} from "@/lib/providers/image-registry";
import { getRotatedHeaders } from "@/lib/ip-rotation";
import crypto from "crypto";

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
  size?: string; // FreeGen aspect ratio: square, widescreen_169, etc.
  style?: string; // FreepikAI style: Photorealistic, Digital Art, etc.
  aspect?: string; // FreepikAI aspect: "1:1", "16:9", "9:16", "4:3"
  // NSFW Gateway BYOK
  byok_token?: string; // JWT token for nsfw-gateway
  byok_device_id?: string; // device-id for nsfw-gateway
  resourceId?: string; // source image ID for image2video etc
  duration?: number; // video duration in seconds
}

const DEFAULT_MODEL_ID = "poll-flux";

// ─── FreeGen constants ──────────────────────────────────────────────────────
const FREEGEN_SIGNER_URL = "https://prompt-signer.freegen.app";
const FREEGEN_GENERATOR_URL = "https://image-generator.freegen.app";
const FREEGEN_WEBSOCKET_URL = "wss://websocket-bridge.freegen.app/ws";

const FREEGEN_SIZE_MAP: Record<string, string> = {
  square: "1:1",
  widescreen_169: "16:9",
  portrait_45: "4:5",
  portrait_23: "2:3",
  story_916: "9:16",
  landscape_43: "4:3",
  landscape_32: "3:2",
};

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
  const MAX_RETRIES = 2;
  let lastError: string = "";

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      // Exponential backoff: 1s, 2s
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

        // If we get 403/502/503, retry. For 400/401/429, don't retry (client error).
        if (chatRes.status === 400 || chatRes.status === 401 || chatRes.status === 429) {
          break; // Don't retry client errors
        }
        continue; // Retry on 403, 502, 503, etc.
      }

      const chatData = await chatRes.json();
      const content: string = chatData?.choices?.[0]?.message?.content || "";

      // Look for markdown image link OR raw URL
      const mdMatch = content.match(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/);
      const urlMatch = content.match(/(https?:\/\/[^\s"'<>)]+\.(?:png|jpg|jpeg|webp))/i);
      const imageUrl = mdMatch?.[1] || urlMatch?.[1];

      if (!imageUrl) {
        lastError = `FreeGPT did not return an image URL. Content preview: ${content.slice(0, 200)}`;
        continue; // Retry — model may not have generated image on first try
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
      continue; // Retry on network errors
    }
  }

  // FreeGPT failed after retries — fall back to Pollinations Flux
  try {
    const fallbackModel = findImageModel("poll-flux");
    if (fallbackModel) {
      const fallbackResult = await handlePollinations(fallbackModel, req, signal);
      // Wrap the fallback response with metadata about the fallback
      const fallbackData = await (fallbackResult as NextResponse).json();
      return NextResponse.json({
        ...fallbackData,
        fallback: true,
        fallback_reason: `FreeGPT unavailable (${lastError}). Fell back to Pollinations Flux.`,
        original_model: model.id,
        original_provider: "freegpt",
      });
    }
  } catch {
    // Fallback also failed — return original error
  }

  return NextResponse.json(
    { error: `FreeGPT image generation failed after ${MAX_RETRIES + 1} attempts`, detail: lastError },
    { status: 502 },
  );
}

// ─── FreeGen handler (WebSocket task queue) ─────────────────────────────────

function createWebSocketAuth(jobId: string, timestamp: number): string {
  const message = jobId + timestamp;
  const hashHex = crypto.createHash("sha256").update(message).digest("hex");
  const b64 = Buffer.from(hashHex).toString("base64");
  return b64.substring(0, 20) + ":" + timestamp;
}

async function waitForImageViaWebSocket(
  jobId: string,
  timeoutMs = 35000,
): Promise<string> {
  const ws = (await import("ws")).default;
  return new Promise<string>((resolve, reject) => {
    const timestamp = Math.floor(Date.now() / 1000);
    const auth = createWebSocketAuth(jobId, timestamp);
    const socket = new ws(FREEGEN_WEBSOCKET_URL);
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error("FreeGen: image generation timed out. Please retry."));
    }, timeoutMs);
    socket.on("open", () => {
      socket.send(JSON.stringify({ type: "subscribe", job_id: jobId, auth }));
    });
    socket.on("message", (rawData: Buffer) => {
      try {
        const msg = JSON.parse(rawData.toString());
        if (msg.type === "result") {
          clearTimeout(timeout);
          socket.close();
          resolve(msg.image_data);
        }
      } catch {}
    });
    socket.on("error", (err: Error) => {
      clearTimeout(timeout);
      reject(new Error(`FreeGen WebSocket error: ${err.message}`));
    });
  });
}

async function handleFreeGen(model: ImageModel, req: ImageRequest, signal?: AbortSignal) {
  const prompt = req.prompt || "";
  const size = req.size || "square";
  const ratio_id = FREEGEN_SIZE_MAP[size] || "1:1";

  // Step 1: Sign prompt
  const signerRes = await fetch(FREEGEN_SIGNER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
    signal,
  });
  if (!signerRes.ok) {
    return NextResponse.json(
      { error: `FreeGen signer failed with status ${signerRes.status}` },
      { status: 502 },
    );
  }
  const { ts, sig } = (await signerRes.json()) as { ts: number; sig: string };

  // Step 2: Submit to queue
  const genRes = await fetch(FREEGEN_GENERATOR_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, ts, sig, ratio_id }),
    signal,
  });
  if (!genRes.ok) {
    const errJson = await genRes.json().catch(() => ({}));
    return NextResponse.json(
      { error: (errJson as { error?: string }).error || `FreeGen generator failed: ${genRes.status}` },
      { status: 502 },
    );
  }
  const { job_id } = (await genRes.json()) as { job_id?: string };
  if (!job_id) {
    return NextResponse.json({ error: "FreeGen: no job_id returned" }, { status: 502 });
  }

  // Step 3: Wait for result via WebSocket
  const imageUrl = await waitForImageViaWebSocket(job_id);
  return NextResponse.json({
    success: true,
    images: [{ url: imageUrl, format: "png" }],
    model: model.id,
    model_name: model.name,
    category: model.category,
    provider: "freegen",
    prompt,
    size,
    ratio_id,
    job_id,
  });
}

// ─── FreepikAI handler (Turnstile-verified, UUID-per-request) ────────────────
// FreepikAI uses Cloudflare Turnstile for bot verification.
// We spawn a headless browser to solve the Turnstile challenge,
// then POST to /generator with the verified token.
// Each request uses a fresh UUID session for higher rate limits.

const FREEPIKAI_URL = "https://www.freepikai.net/generator";
const FREEPIKAI_REFERER = "https://www.freepikai.net/";
const FREEPIKAI_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const TURNSTILE_SITEKEY = "0x4AAAAAACJb-k4QlyYt-bQg";

async function handleFreepikAI(
  model: ImageModel,
  req: ImageRequest,
  signal?: AbortSignal,
) {
  const prompt = req.prompt || "";
  const style = model.upstreamModel || req.style || "Photorealistic";
  const aspect = req.aspect || "1:1";
  const requestId = crypto.randomUUID();

  try {
    // Use Playwright to solve Turnstile and get a verified token
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: FREEPIKAI_UA,
      extraHTTPHeaders: { "X-Request-ID": requestId },
    });
    const page = await context.newPage();

    let turnstileToken = "";
    let apiResult: { status: string; msg: string; pic?: string; downloadUrl?: string } | null = null;

    try {
      // Navigate to FreepikAI
      await page.goto(FREEPIKAI_REFERER, { waitUntil: "domcontentloaded", timeout: 30000 });

      // Wait for Turnstile to be available
      await page.waitForFunction(
        `typeof turnstile !== 'undefined'`,
        { timeout: 15000 },
      );

      // Set the prompt
      await page.fill("#promptInput", prompt);

      // Select the style chip
      const styleChip = page.locator(`.style-chip[data-style="${style}"]`);
      if ((await styleChip.count()) > 0) {
        await styleChip.click();
      }

      // Select the aspect ratio
      const aspectSelect = page.locator("#aspectSelect");
      if ((await aspectSelect.count()) > 0) {
        const aspectMap: Record<string, string> = {
          "1:1": "1:1 Square",
          "16:9": "16:9 Landscape",
          "9:16": "9:16 Portrait",
          "4:3": "4:3 Standard",
        };
        await aspectSelect.selectOption({ label: aspectMap[aspect] || "1:1 Square" });
      }

      // Intercept the API call to capture the response
      const apiPromise = page.waitForResponse(
        (resp) => resp.url().includes("/generator") && resp.request().method() === "POST",
        { timeout: 120000 },
      );

      // Click generate — this triggers Turnstile then the API call
      await page.click("#generateBtn");

      // Wait for the API response
      const apiResponse = await apiPromise;
      apiResult = await apiResponse.json();
    } finally {
      await browser.close();
    }

    if (apiResult?.status === "success" && apiResult.pic) {
      return NextResponse.json({
        success: true,
        images: [{ url: apiResult.pic, format: "jpg" }],
        model: model.id,
        model_name: model.name,
        category: model.category,
        provider: "freepikai",
        prompt,
        style,
        aspect,
        request_id: requestId,
        download_url: apiResult.downloadUrl || apiResult.pic,
      });
    }

    // FreepikAI failed — fall back to Pollinations Flux
    const fallbackModel = findImageModel("poll-flux");
    if (fallbackModel) {
      const fallbackResult = await handlePollinations(fallbackModel, req, signal);
      const fallbackData = await (fallbackResult as NextResponse).json();
      return NextResponse.json({
        ...fallbackData,
        fallback: true,
        fallback_reason: `FreepikAI failed (${apiResult?.msg || "unknown"}). Fell back to Pollinations Flux.`,
        original_model: model.id,
        original_provider: "freepikai",
      });
    }

    return NextResponse.json(
      { error: `FreepikAI generation failed: ${apiResult?.msg || "unknown error"}` },
      { status: 502 },
    );
  } catch (e) {
    // Playwright not available or browser failed — fall back gracefully
    const errMsg = e instanceof Error ? e.message : "Unknown error";
    const fallbackModel = findImageModel("poll-flux");
    if (fallbackModel) {
      const fallbackResult = await handlePollinations(fallbackModel, req, signal);
      const fallbackData = await (fallbackResult as NextResponse).json();
      return NextResponse.json({
        ...fallbackData,
        fallback: true,
        fallback_reason: `FreepikAI browser error (${errMsg}). Fell back to Pollinations Flux.`,
        original_model: model.id,
        original_provider: "freepikai",
      });
    }
    return NextResponse.json(
      { error: `FreepikAI generation failed: ${errMsg}` },
      { status: 502 },
    );
  }
}

// ─── AIAnime handler (api.aianime.io, IP rotation + proxy for Vercel) ──────────
// IMPORTANT: AIAnime API uses application/x-www-form-urlencoded, NOT JSON.
// On Vercel, direct calls get blocked (403). We fall back to the
// aianime-proxy mini-service (port 3031) which runs on a different IP.

const AIANIME_TEXT2IMAGE_URL = "https://api.aianime.io/api/image-generate/text2image";
const AIANIME_RESULT_ENDPOINTS = [
  "https://api.aianime.io/api/image-generate/text2image/result",
  "https://api.aianime.io/api/image-generate/result",
];
const AIANIME_PROXY_PORT = 3031;
const AIANIME_POLL_INTERVAL_MS = 2000;
const AIANIME_POLL_MAX_ATTEMPTS = 15;

async function handleAIAnime(model: ImageModel, req: ImageRequest, signal?: AbortSignal) {
  const prompt = req.prompt || "";
  const MAX_RETRIES = 5;
  let lastError: string = "";

  // Build form-urlencoded body for AIAnime API
  const formData = new URLSearchParams();
  formData.set("prompt", prompt);
  formData.set("model_type", "anime_io");
  if (req.nsfw) formData.set("negative_prompt", "");
  if (req.size) formData.set("aspect_ratio", req.size);

  // Strategy 1: Direct call with IP rotation
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = 300 + Math.random() * 700;
      await new Promise((r) => setTimeout(r, delay));
    }

    const headers = getRotatedHeaders({
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Origin: "https://aianime.io",
      Referer: "https://aianime.io/",
    });

    try {
      const res = await fetch(AIANIME_TEXT2IMAGE_URL, {
        method: "POST",
        headers,
        body: formData.toString(),
        signal: signal ?? AbortSignal.timeout(30000),
      });

      if (res.status === 429 || res.status === 403) {
        lastError = `Rate limited/blocked (HTTP ${res.status}, attempt ${attempt + 1}/${MAX_RETRIES})`;
        continue;
      }

      if (!res.ok) {
        lastError = `AIAnime API error (HTTP ${res.status})`;
        continue;
      }

      const data = await res.json() as { code?: number; result?: { job_id?: string; free_limit_value?: number; image_url?: string; status?: string }; message?: unknown };

      const jobId = data.result?.job_id;

      // Try to poll for the actual image result
      let imageUrl: string | undefined;
      if (jobId) {
        for (const endpoint of AIANIME_RESULT_ENDPOINTS) {
          for (let pollAttempt = 0; pollAttempt < AIANIME_POLL_MAX_ATTEMPTS; pollAttempt++) {
            if (signal?.aborted) break;
            await new Promise((r) => setTimeout(r, pollAttempt === 0 ? 1000 : AIANIME_POLL_INTERVAL_MS));
            try {
              const pollHeaders = getRotatedHeaders({
                Accept: "application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                Origin: "https://aianime.io",
                Referer: "https://aianime.io/",
              });
              const pollRes = await fetch(`${endpoint}?job_id=${encodeURIComponent(jobId)}`, {
                method: "GET",
                headers: pollHeaders,
                signal: signal ?? AbortSignal.timeout(10000),
              });
              if (!pollRes.ok) continue;
              const pollData = await pollRes.json() as {
                code?: number;
                result?: { image_url?: string; url?: string; status?: string };
                image_url?: string;
                status?: string;
              };
              const result = pollData.result || {};
              const foundUrl = result.image_url || result.url || pollData.image_url;
              if (foundUrl) { imageUrl = foundUrl; break; }
              const pollStatus = result.status || pollData.status;
              if (pollStatus === "processing" || pollStatus === "pending" || pollStatus === "queued") continue;
              if (pollData.code === 200 && Object.keys(result).length > 0) break;
              if (pollData.code && pollData.code !== 200 && pollData.code !== 102) break;
            } catch { continue; }
          }
          if (imageUrl) break;
        }
      }

      if (imageUrl) {
        return NextResponse.json({
          success: true,
          images: [{ url: imageUrl, format: "png" }],
          model: model.id,
          model_name: model.name,
          category: model.category,
          provider: "aianime",
          prompt,
          job_id: jobId,
          status: "completed",
        });
      }

      // No image URL yet — return job_id with polling info
      return NextResponse.json({
        success: true,
        images: [{ url: `aianime://job/${jobId || "unknown"}`, format: "pending" }],
        model: model.id,
        model_name: model.name,
        category: model.category,
        provider: "aianime",
        prompt,
        job_id: jobId,
        free_limit_value: data.result?.free_limit_value,
        status: "processing",
        poll: {
          url_template: `${AIANIME_RESULT_ENDPOINTS[0]}?job_id={job_id}`,
          interval_ms: AIANIME_POLL_INTERVAL_MS,
          max_attempts: AIANIME_POLL_MAX_ATTEMPTS,
          job_id: jobId,
          note: "Image is still generating. Poll the result endpoint to get the image URL when status is 'completed'.",
        },
        raw: data,
      });
    } catch (e) {
      lastError = e instanceof Error ? e.message : "Network error";
      if (signal?.aborted) break;
      continue;
    }
  }

  // Strategy 2: Try the aianime-proxy mini-service (for Vercel deployment)
  try {
    const proxyUrl = `/api/image-generate/text2image?XTransformPort=${AIANIME_PROXY_PORT}`;
    const proxyRes = await fetch(proxyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: formData.toString(),
      signal: signal ?? AbortSignal.timeout(30000),
    });

    if (proxyRes.ok) {
      const data = await proxyRes.json() as { code?: number; result?: { job_id?: string; free_limit_value?: number; image_url?: string; status?: string }; message?: unknown };
      if (data.code === 200 && data.result?.job_id) {
        // If the proxy already resolved the image, return it
        if (data.result.image_url) {
          return NextResponse.json({
            success: true,
            images: [{ url: data.result.image_url, format: "png" }],
            model: model.id,
            model_name: model.name,
            category: model.category,
            provider: "aianime",
            prompt,
            job_id: data.result.job_id,
            status: "completed",
          });
        }
        // Otherwise return job_id with polling info
        return NextResponse.json({
          success: true,
          images: [{ url: `aianime://job/${data.result.job_id}`, format: "pending" }],
          model: model.id,
          model_name: model.name,
          category: model.category,
          provider: "aianime",
          prompt,
          job_id: data.result.job_id,
          free_limit_value: data.result.free_limit_value,
          status: "processing",
          poll: {
            url_template: `${AIANIME_RESULT_ENDPOINTS[0]}?job_id={job_id}`,
            interval_ms: AIANIME_POLL_INTERVAL_MS,
            max_attempts: AIANIME_POLL_MAX_ATTEMPTS,
            job_id: data.result.job_id,
            note: "Image is still generating. Poll the result endpoint.",
          },
          raw: data,
        });
      }
    }
  } catch {}

  // Strategy 3: Fall back to Pollinations Flux, with direct_call info
  try {
    const fallbackModel = findImageModel("poll-flux");
    if (fallbackModel) {
      const fallbackResult = await handlePollinations(fallbackModel, req, signal);
      const fallbackData = await (fallbackResult as NextResponse).json();
      const aianimeFormData = new URLSearchParams();
      aianimeFormData.set("prompt", prompt);
      aianimeFormData.set("model_type", "anime_io");
      return NextResponse.json({
        ...fallbackData,
        fallback: true,
        fallback_reason: `AIAnime unavailable (${lastError}). Fell back to Pollinations Flux.`,
        original_model: model.id,
        original_provider: "aianime",
        direct_call: {
          url: AIANIME_TEXT2IMAGE_URL,
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: aianimeFormData.toString(),
          poll: {
            url_template: `${AIANIME_RESULT_ENDPOINTS[0]}?job_id={job_id}`,
            interval_ms: AIANIME_POLL_INTERVAL_MS,
            max_attempts: AIANIME_POLL_MAX_ATTEMPTS,
          },
          note: "Server-side call blocked. Call from browser (CORS open). After getting job_id, poll the result endpoint.",
        },
      });
    }
  } catch {}

  return NextResponse.json(
    { error: `AIAnime text2image failed after all strategies`, detail: lastError },
    { status: 502 },
  );
}

// ─── NSFW Gateway handler (gateway.nsfwimg2video.com, BYOK JWT token) ──────────
// User provides their own JWT token + device-id from nsfwimg2video.com.
// Gateway has CORS: * — browser can call directly, but we also support server-side.
// Auth: raw JWT in lowercase `authorization` header (NO "Bearer " prefix).

const NSFW_GW_BASE = "https://gateway.nsfwimg2video.com/web";
const NSFW_GW_POLL_INTERVAL_MS = 3000;
const NSFW_GW_POLL_MAX_MS = 180000; // 3 min max poll time

async function handleNsfwGateway(model: ImageModel, req: ImageRequest, signal?: AbortSignal) {
  const prompt = req.prompt || "";
  const token = req.byok_token;
  const deviceId = req.byok_device_id;

  if (!token || !deviceId) {
    return NextResponse.json(
      {
        error: "NSFW Gateway requires BYOK credentials. Pass byok_token (JWT) and byok_device_id in the request body.",
        hint: "Get your token from nsfwimg2video.com — run in DevTools console: copy(document.cookie.match(/access_token=([^;]+)/)?.[1])",
        docs: "https://gateway.nsfwimg2video.com",
      },
      { status: 401 },
    );
  }

  const upstreamModel = model.upstreamModel || "wf";
  const now = Date.now();

  // Build form-urlencoded body
  const formParams = new URLSearchParams();
  formParams.set("prompt", prompt);
  if (req.width) formParams.set("width", String(req.width));
  if (req.height) formParams.set("height", String(req.height));
  if (req.duration) formParams.set("duration", String(req.duration));
  if (req.resourceId) formParams.set("resourceId", req.resourceId);

  // For wf model, additional params
  if (upstreamModel === "wf") {
    formParams.set("text", prompt); // wf uses 'text' instead of 'prompt' for the main text field
    if (!req.width) formParams.set("width", "1024");
    if (!req.height) formParams.set("height", "1024");
    formParams.set("resultCount", "1");
  }

  const authHeaders = {
    authorization: token, // Raw JWT, lowercase, NO "Bearer " prefix
    "x-device-id": deviceId,
    "x-time": String(now),
    "x-country": "US",
    "Content-Type": "application/x-www-form-urlencoded",
  };

  // Step 1: Create task
  const createUrl = `${NSFW_GW_BASE}/users/me/models/${upstreamModel}/tasks?locale=en`;
  try {
    const createRes = await fetch(createUrl, {
      method: "POST",
      headers: authHeaders,
      body: formParams.toString(),
      signal: signal ?? AbortSignal.timeout(30000),
    });

    if (createRes.status === 401) {
      return NextResponse.json(
        { error: "NSFW Gateway: Invalid or expired token. Re-login to nsfwimg2video.com and get a fresh token." },
        { status: 401 },
      );
    }

    if (!createRes.ok) {
      const errText = await createRes.text().catch(() => "");
      return NextResponse.json(
        { error: `NSFW Gateway: Task creation failed (HTTP ${createRes.status}): ${errText.slice(0, 300)}` },
        { status: 502 },
      );
    }

    const createData = await createRes.json() as {
      success: boolean;
      errorCode?: number;
      data?: { taskId?: string; progress?: { index?: number; left?: string; progress?: number } };
      errorMsg?: string;
    };

    if (!createData.success || !createData.data?.taskId) {
      return NextResponse.json(
        { error: `NSFW Gateway: Task creation failed — ${createData.errorMsg || "unknown"}`, raw: createData },
        { status: 502 },
      );
    }

    const taskId = createData.data.taskId;

    // Step 2: Poll until complete (status 2) or timeout
    const pollUrl = `${NSFW_GW_BASE}/users/me/tasks/${taskId}?locale=en`;
    const pollStart = Date.now();

    while (Date.now() - pollStart < NSFW_GW_POLL_MAX_MS) {
      if (signal?.aborted) break;

      await new Promise((r) => setTimeout(r, NSFW_GW_POLL_INTERVAL_MS));

      const pollHeaders = {
        authorization: token,
        "x-device-id": deviceId,
        "x-time": String(Date.now()),
        "x-country": "US",
      };

      try {
        const pollRes = await fetch(pollUrl, {
          method: "GET",
          headers: pollHeaders,
          signal: AbortSignal.timeout(10000),
        });

        if (!pollRes.ok) continue;

        const pollData = await pollRes.json() as {
          success: boolean;
          data?: {
            taskId?: string;
            status?: number; // 0=queued, 1=processing, 2=complete
            progress?: { index?: number; left?: string; progress?: number };
            fileInfos?: { type?: string; fileUrl?: string }[];
          };
          errorMsg?: string;
        };

        const status = pollData.data?.status;
        const progress = pollData.data?.progress?.progress ?? 0;

        if (status === 2 && pollData.data?.fileInfos) {
          // Complete! Find the image/video URL
          const imageFile = pollData.data.fileInfos.find((f) => f.type === "cover" || f.type === "image");
          const videoFile = pollData.data.fileInfos.find((f) => f.type === "video");
          const anyFile = pollData.data.fileInfos[0];

          const resultUrl = imageFile?.fileUrl || videoFile?.fileUrl || anyFile?.fileUrl;

          if (resultUrl) {
            const isVideo = videoFile?.fileUrl === resultUrl;
            return NextResponse.json({
              success: true,
              images: [{ url: resultUrl, format: isVideo ? "mp4" : "jpg" }],
              model: model.id,
              model_name: model.name,
              category: model.category,
              provider: "nsfw-gateway",
              prompt,
              task_id: taskId,
              status: "completed",
              progress: 100,
              fileInfos: pollData.data.fileInfos,
            });
          }
        }

        // Still processing — continue polling
        if (status === 0 || status === 1) continue;

        // Unknown status — break and return what we have
        break;
      } catch {
        continue;
      }
    }

    // Timeout — return task_id with polling info so client can continue
    return NextResponse.json({
      success: true,
      images: [{ url: `nsgw://task/${taskId}`, format: "pending" }],
      model: model.id,
      model_name: model.name,
      category: model.category,
      provider: "nsfw-gateway",
      prompt,
      task_id: taskId,
      status: "processing",
      progress: 0,
      poll: {
        url: pollUrl,
        headers: { authorization: "<your-token>", "x-device-id": deviceId, "x-time": "<current ms>", "x-country": "US" },
        interval_ms: NSFW_GW_POLL_INTERVAL_MS,
        note: "Task is still generating. Poll the URL with the same auth headers until status=2 and fileInfos is populated.",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { error: `NSFW Gateway failed: ${msg}` },
      { status: 500 },
    );
  }
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

  // Unrestricted consent gate
  if ((model.category === "unrestricted-anime" || model.category === "unrestricted-realism" || model.category === "unrestricted-mixed") && body.nsfw !== true) {
    return NextResponse.json({
      error: 'This model is unrestricted. Pass "nsfw": true in the request body to confirm you are 18+ and consent to adult content.',
      model: modelId, category: model.category,
    }, { status: 403 });
  }

  const origin = new URL(request.url).origin;
  try {
    switch (model.provider) {
      case "pollinations-gen": return await handlePollinations(model, body, request.signal);
      case "freegpt": return await handleFreeGpt(model, body, origin, request.signal);
      case "freepikai": return await handleFreepikAI(model, body, request.signal);
      case "freegen": return await handleFreeGen(model, body, request.signal);
      case "aianime": return await handleAIAnime(model, body, request.signal);
      case "nsfw-gateway": return await handleNsfwGateway(model, body, request.signal);
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
    params: ["prompt (required)", "model", "width", "height", "seed", "nologo", "nsfw (true for unrestricted, 18+)"],
    categories: ["anime", "realism", "mixed", "general", "unrestricted-anime", "unrestricted-realism", "unrestricted-mixed"],
    providers: "All providers are 100% free, no signup, no API key, instant (no queues). REAL AI generators only.",
    models,
  });
}

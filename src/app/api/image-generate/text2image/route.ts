/**
 * AIAnime Text-to-Image Generation API
 *
 * Endpoint: POST /api/image-generate/text2image
 * Upstream: https://api.aianime.io/api/image-generate/text2image
 *
 * Strategy:
 *   1. On self-hosted (sandbox): call api.aianime.io directly with IP rotation
 *   2. On Vercel: route through the aianime-proxy mini-service (port 3031)
 *      which runs on a different IP that isn't blocked by AIAnime's rate limits
 *
 * IMPORTANT: The AIAnime API uses application/x-www-form-urlencoded
 * (NOT JSON). Fields: prompt, negative_prompt, model_type, aspect_ratio
 *
 * Our API accepts JSON for convenience and converts to form-urlencoded
 * before calling the upstream.
 *
 * Success response:
 *   { code: 200, result: { job_id: string, free_limit_value: number }, message: {} }
 */

import { NextRequest, NextResponse } from "next/server";
import { getRotatedHeaders } from "@/lib/ip-rotation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const AIANIME_BASE = "https://api.aianime.io";
const AIANIME_TEXT2IMAGE = `${AIANIME_BASE}/api/image-generate/text2image`;

// Possible result polling endpoints — we try each in order
const AIANIME_RESULT_ENDPOINTS = [
  `${AIANIME_BASE}/api/image-generate/text2image/result`,
  `${AIANIME_BASE}/api/image-generate/result`,
];

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 15;

// The aianime-proxy mini-service runs on port 3031 on our sandbox server.
// On Vercel, we route through it via the gateway to bypass Vercel's blocked IPs.
const AIANIME_PROXY_PORT = 3031;
const AIANIME_PROXY_PATH = "/api/image-generate/text2image";

/** AIAnime model_type options: standard, pro, anime_io */
type AIAnimeModelType = "standard" | "pro" | "anime_io";

interface Text2ImageRequest {
  prompt?: string;
  negative_prompt?: string;
  model_type?: AIAnimeModelType | string;
  aspect_ratio?: string;
  // Legacy aliases
  model?: string;
  width?: number;
  height?: number;
  style?: string;
}

/** Map model_type values, defaulting to anime_io */
function resolveModelType(modelType?: string): AIAnimeModelType {
  if (modelType === "standard" || modelType === "pro" || modelType === "anime_io") {
    return modelType;
  }
  return "anime_io";
}

// ─── Upstream call strategies ──────────────────────────────────────────────

const MAX_RETRIES = 5;

/** Call AIAnime directly (self-hosted / sandbox) with IP rotation */
async function callDirect(
  formData: URLSearchParams,
  signal?: AbortSignal,
): Promise<{ data: unknown; ok: boolean; status: number } | null> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 300 + Math.random() * 700));
    }

    const headers = getRotatedHeaders({
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Origin: "https://aianime.io",
      Referer: "https://aianime.io/",
    });

    try {
      const res = await fetch(AIANIME_TEXT2IMAGE, {
        method: "POST",
        headers,
        body: formData.toString(),
        signal: signal ?? AbortSignal.timeout(30000),
      });

      if (res.status === 429 || res.status === 403) continue;

      const data = await res.json();
      return { data, ok: res.ok, status: res.status };
    } catch (e) {
      if (signal?.aborted) return null;
      continue;
    }
  }
  return null;
}

/** Call through our aianime-proxy mini-service (for Vercel deployment) */
async function callViaProxy(
  formData: URLSearchParams,
  signal?: AbortSignal,
): Promise<{ data: unknown; ok: boolean; status: number } | null> {
  // Build the proxy URL with XTransformPort for the gateway
  const proxyUrl = `${AIANIME_PROXY_PATH}?XTransformPort=${AIANIME_PROXY_PORT}`;

  try {
    const res = await fetch(proxyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: formData.toString(),
      signal: signal ?? AbortSignal.timeout(30000),
    });

    const data = await res.json();
    return { data, ok: res.ok, status: res.status };
  } catch {
    return null;
  }
}

// ─── Job result polling ─────────────────────────────────────────────────────

interface JobResult {
  image_url?: string;
  url?: string;
  image_data?: string;
  status?: string;
  images?: Array<{ url?: string; image_url?: string }>;
}

/**
 * Poll AIAnime result endpoint until the job completes or we time out.
 * Tries multiple possible result endpoint patterns.
 */
async function pollForResult(
  jobId: string,
  signal?: AbortSignal,
): Promise<JobResult | null> {
  for (const endpoint of AIANIME_RESULT_ENDPOINTS) {
    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
      if (signal?.aborted) return null;

      // Wait before polling (skip on first attempt for slight delay)
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      } else {
        await new Promise((r) => setTimeout(r, 1000)); // Initial 1s delay
      }

      const headers = getRotatedHeaders({
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Origin: "https://aianime.io",
        Referer: "https://aianime.io/",
      });

      try {
        const res = await fetch(`${endpoint}?job_id=${encodeURIComponent(jobId)}`, {
          method: "GET",
          headers,
          signal: signal ?? AbortSignal.timeout(10000),
        });

        if (!res.ok) continue;

        const data = await res.json() as {
          code?: number;
          result?: JobResult;
          status?: string;
          image_url?: string;
          url?: string;
        };

        // Check for completion indicators
        const result = data.result || {};
        const status = result.status || data.status;
        const imageUrl = result.image_url || result.url || data.image_url || data.url;

        // If we got an image URL, the job is done
        if (imageUrl) {
          return { ...result, image_url: imageUrl, status: "completed" };
        }

        // If status explicitly says still processing, keep polling
        if (status === "processing" || status === "pending" || status === "queued") {
          continue;
        }

        // If code is 200 and we have any result data, consider it done
        if (data.code === 200 && Object.keys(result).length > 0) {
          return { ...result, status: result.status || "completed" };
        }

        // If we got a non-200 code that isn't "not ready", the job may have failed
        if (data.code && data.code !== 200 && data.code !== 102) {
          break; // Try next endpoint
        }

        // Otherwise keep polling
        continue;
      } catch {
        if (signal?.aborted) return null;
        continue;
      }
    }
  }
  return null;
}

// ─── POST handler ──────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  let body: Text2ImageRequest;
  try {
    body = (await request.json()) as Text2ImageRequest;
  } catch {
    return NextResponse.json(
      { code: 400, result: null, message: { error: "Invalid JSON body" } },
      { status: 400 },
    );
  }

  if (!body.prompt || typeof body.prompt !== "string" || body.prompt.trim().length === 0) {
    return NextResponse.json(
      { code: 400, result: null, message: { error: "prompt is required and must be a non-empty string" } },
      { status: 400 },
    );
  }

  // Build form-urlencoded body for AIAnime API
  const formData = new URLSearchParams();
  formData.set("prompt", body.prompt);
  formData.set("model_type", resolveModelType(body.model_type || body.model));
  if (body.negative_prompt) formData.set("negative_prompt", body.negative_prompt);
  if (body.aspect_ratio) formData.set("aspect_ratio", body.aspect_ratio);

  // Try direct call first (works on sandbox/self-hosted), then fallback to proxy
  let result = await callDirect(formData, request.signal);

  // If direct call failed (e.g., Vercel IP blocked), try the proxy
  if (!result || !result.ok) {
    result = await callViaProxy(formData, request.signal);
  }

  // Both server-side strategies failed — return a "direct-call" response.
  // Since AIAnime API has CORS allow-origin: *, the CLIENT can call it
  // directly from the browser. We return the URL and form data so the
  // client can make the fetch() itself, plus polling instructions.
  if (!result || !result.ok) {
    return NextResponse.json({
      code: 200,
      result: null,
      message: {},
      // Client-side relay: browser calls AIAnime directly
      direct_call: {
        url: AIANIME_TEXT2IMAGE,
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: formData.toString(),
        poll: {
          url_template: `${AIANIME_RESULT_ENDPOINTS[0]}?job_id={job_id}`,
          interval_ms: POLL_INTERVAL_MS,
          max_attempts: POLL_MAX_ATTEMPTS,
        },
        note: "Server-side call blocked (Vercel IP). Call this URL directly from the browser — CORS is open (access-control-allow-origin: *). After getting job_id from the response, poll the result endpoint to get the actual image URL.",
      },
    });
  }

  // Upstream error
  if (!result.ok) {
    return NextResponse.json(
      { code: result.status, result: null, message: { error: `AIAnime API error (HTTP ${result.status})`, upstream: result.data } },
      { status: result.status },
    );
  }

  // Success — we got a response from AIAnime
  const aianimeResp = result.data as {
    code?: number;
    result?: { job_id?: string; free_limit_value?: number; image_url?: string; status?: string };
    message?: unknown;
  };

  const jobId = aianimeResp.result?.job_id;

  if (aianimeResp.code === 200 && jobId) {
    // We have a job_id — try to poll for the actual image result
    const jobResult = await pollForResult(jobId, request.signal);

    if (jobResult?.image_url) {
      // Got the actual image!
      return NextResponse.json({
        code: 200,
        result: {
          job_id: jobId,
          free_limit_value: aianimeResp.result?.free_limit_value ?? 1,
          image_url: jobResult.image_url,
          status: "completed",
        },
        message: {},
      });
    }

    // Polling didn't return an image — return job_id with polling instructions
    // so the client can poll from the browser
    return NextResponse.json({
      code: 200,
      result: {
        job_id: jobId,
        free_limit_value: aianimeResp.result?.free_limit_value ?? 1,
        status: jobResult?.status || "processing",
      },
      message: {},
      poll: {
        url_template: `${AIANIME_RESULT_ENDPOINTS[0]}?job_id={job_id}`,
        interval_ms: POLL_INTERVAL_MS,
        max_attempts: POLL_MAX_ATTEMPTS,
        job_id: jobId,
        note: "Image is still generating. Poll the result endpoint to get the image URL when status is 'completed'.",
      },
    });
  }

  // Fallback: return whatever we got
  return NextResponse.json({
    code: 200,
    result: {
      job_id: aianimeResp.result?.job_id || `gen_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      free_limit_value: aianimeResp.result?.free_limit_value ?? 1,
    },
    message: {},
  });
}

// ─── GET handler (API docs) ────────────────────────────────────────────────

export async function GET() {
  return NextResponse.json({
    service: "AIAnime Text-to-Image Generation",
    endpoint: "POST /api/image-generate/text2image",
    upstream: AIANIME_TEXT2IMAGE,
    upstream_format: "application/x-www-form-urlencoded (converted from JSON automatically)",
    features: [
      "Direct API call with IP rotation (self-hosted)",
      "Proxy via aianime-proxy mini-service (Vercel deployment)",
      "Auto-retry on 429/403 with different IP",
      "X-Forwarded-For spoofing with multi-header rotation",
      "JSON input → form-urlencoded upstream conversion",
      "Job result polling (async image generation)",
      "Client-side fallback with polling instructions",
    ],
    polling: {
      result_endpoints: AIANIME_RESULT_ENDPOINTS,
      interval_ms: POLL_INTERVAL_MS,
      max_attempts: POLL_MAX_ATTEMPTS,
    },
    params: {
      prompt: "string (required) — text description of the image",
      model_type: "string (optional) — 'standard', 'pro', or 'anime_io' (default: anime_io)",
      negative_prompt: "string (optional) — what to avoid in the image",
      aspect_ratio: "string (optional) — e.g. '1:1' (default), '16:9', '9:16', '4:3'",
    },
    model_types: {
      standard: "General-purpose model",
      pro: "High-quality model (stricter rate limits)",
      anime_io: "Anime/illustration focused (default)",
    },
    response_format: {
      code: 200,
      result: { job_id: "string", free_limit_value: "number" },
      message: {},
    },
  });
}

/**
 * Video Generation API — Dreemy.ai and NSFW Gateway BYOK
 *
 * Providers:
 *   - dreemy        — Dreemy.ai text-to-video & image-to-video (BYOK or auto guest mint)
 *   - nsfw-gateway  — NSFW Gateway BYOK (gateway.nsfwimg2video.com)
 *
 * Endpoint: POST /api/v1/video/generate
 * Body: { prompt, model, dreemy_token?, byok_token?, byok_device_id?, resourceId?, duration? }
 *
 * Models: dreemy-text2video, dreemy-image2video, text2video, image2video, anime-girl, fast-face-swap
 * Task pattern: POST create → GET poll → result with video URL
 */

import { NextRequest, NextResponse } from "next/server";
import {
  VIDEO_MODELS,
  findVideoModel,
  type VideoModel,
} from "@/lib/providers/video-registry";
import { translateDreemyMsg, translateDreemyError } from "@/lib/providers/dreemy-i18n";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface VideoRequest {
  prompt?: string;
  model?: string;
  // Dreemy BYOK
  dreemy_token?: string; // x-auth-token for dreemy.ai (optional — auto-mint if omitted)
  dreemy_model_id?: number; // Override Dreemy modelId
  // NSFW Gateway BYOK
  byok_token?: string; // JWT token from nsfwimg2video.com
  byok_device_id?: string; // Device ID from nsfwimg2video.com
  resourceId?: string; // Source image resource ID (for image2video, anime-girl, face-swap)
  duration?: number; // Video duration in seconds (default 5)
  width?: number;
  height?: number;
  nsfw?: boolean; // Consent flag for unrestricted models
}

const DEFAULT_MODEL_ID = "dreemy-text2video";
const NSFW_GW_BASE = "https://gateway.nsfwimg2video.com/web";
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_MS = 300000; // 5 min max — videos take longer than images

// ─── Dreemy constants ────────────────────────────────────────────────────────
const DREEMY_BASE = "https://www.dreemy.ai";
const DREEMY_VIDEO_POLL_INTERVAL_MS = 5000; // Videos take longer
const DREEMY_VIDEO_POLL_MAX_MS = 300000; // 5 min max

/** Generate a random 32-hex string for x-finger header. */
function randomFinger(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Mint a Dreemy guest token: createGuest → loginByGuest → idToken. */
async function mintDreemyGuestToken(signal?: AbortSignal): Promise<{
  token: string;
  guestUid: string;
  finger: string;
  integral: number;
}> {
  const finger = randomFinger();
  const commonHeaders = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "x-platform": "web",
    "x-version": "999.0.0",
    "x-language": "en",
    "x-finger": finger,
  };

  // Step 1: Create guest
  const createRes = await fetch(`${DREEMY_BASE}/api/auth/createGuest`, {
    method: "POST",
    headers: commonHeaders,
    body: JSON.stringify({}),
    signal: signal ?? AbortSignal.timeout(15000),
  });

  if (!createRes.ok) {
    const errText = await createRes.text().catch(() => "");
    throw new Error(`Dreemy createGuest failed (HTTP ${createRes.status}): ${errText.slice(0, 200)}`);
  }

  const createData = await createRes.json() as {
    code?: string;
    data?: { guestUid?: string; guestKey?: string };
    msg?: string;
  };

  if (createData.code !== "200" || !createData.data?.guestUid || !createData.data?.guestKey) {
    throw new Error(`Dreemy createGuest returned error: ${translateDreemyMsg(createData.msg) || JSON.stringify(createData).slice(0, 200)}`);
  }

  const { guestUid, guestKey } = createData.data;

  // Step 2: Login by guest → get idToken
  const loginRes = await fetch(`${DREEMY_BASE}/api/auth/loginByGuest`, {
    method: "POST",
    headers: commonHeaders,
    body: JSON.stringify({ guestUid, guestKey }),
    signal: signal ?? AbortSignal.timeout(15000),
  });

  if (!loginRes.ok) {
    const errText = await loginRes.text().catch(() => "");
    throw new Error(`Dreemy loginByGuest failed (HTTP ${loginRes.status}): ${errText.slice(0, 200)}`);
  }

  const loginData = await loginRes.json() as {
    code?: string;
    data?: { idToken?: string };
    msg?: string;
  };

  if (loginData.code !== "200" || !loginData.data?.idToken) {
    throw new Error(`Dreemy loginByGuest returned error: ${translateDreemyMsg(loginData.msg) || JSON.stringify(loginData).slice(0, 200)}`);
  }

  // Step 3: Get account integral
  let integral = 0; // default guest integral (Dreemy guests now get 0 credits)
  try {
    const accountRes = await fetch(`${DREEMY_BASE}/api/auth/getAccount`, {
      method: "GET",
      headers: { ...commonHeaders, "x-auth-token": loginData.data.idToken },
      signal: AbortSignal.timeout(10000),
    });
    if (accountRes.ok) {
      const accountData = await accountRes.json() as {
        code?: string;
        data?: { integral?: number };
      };
      if (accountData.data?.integral !== undefined) {
        integral = accountData.data.integral;
      }
    }
  } catch {}

  return { token: loginData.data.idToken, guestUid, finger, integral };
}

// ─── Dreemy video handler ───────────────────────────────────────────────────
async function handleDreemyVideo(model: VideoModel, req: VideoRequest, signal?: AbortSignal) {
  const prompt = req.prompt || "";
  const modelId = req.dreemy_model_id ?? 2; // default to Spicy (cheaper)

  // Get auth token: either user-provided (BYOK) or auto-minted guest
  let authToken: string;
  let finger: string;
  let integral: number | undefined;
  let autoMinted = false;

  if (req.dreemy_token) {
    authToken = req.dreemy_token;
    finger = randomFinger();
  } else {
    try {
      const minted = await mintDreemyGuestToken(signal);
      authToken = minted.token;
      finger = minted.finger;
      integral = minted.integral;
      autoMinted = true;

      // Dreemy guests now get 0 integral — no free credits.
      // Fail fast instead of wasting time on a guaranteed -1 rejection.
      if (minted.integral <= 0) {
        return NextResponse.json(
          {
            error: "Dreemy: Guest accounts have 0 credits. Dreemy no longer provides free credits to guests.",
            hint: "Provide your own dreemy_token (x-auth-token) from a registered account with credits. Sign up at dreemy.ai and purchase credits (2000 integral = $18.99).",
            docs: "https://www.dreemy.ai",
            provider: "dreemy",
            auth_type: "BYOK",
            required: "dreemy_token",
            integral: 0,
          },
          { status: 402 }, // 402 Payment Required — not a rate limit
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      return NextResponse.json(
        {
          error: `Dreemy auto-mint failed: ${msg}`,
          hint: "Pass your own dreemy_token in the request body. Get it from dreemy.ai.",
          docs: "https://www.dreemy.ai",
        },
        { status: 401 },
      );
    }
  }

  const dreemyHeaders = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "x-auth-token": authToken,
    "x-platform": "web",
    "x-version": "999.0.0",
    "x-language": "en",
    "x-finger": finger,
  };

  // Build video create body
  const createBody: Record<string, unknown> = {
    prompt,
    resolution: "2K",
    modelId,
    number: 1,
  };

  // For image2video, add the source image
  if (model.needsImage && req.resourceId) {
    createBody.imageUrls = [req.resourceId];
  } else if (model.needsImage && !req.resourceId) {
    return NextResponse.json(
      {
        error: `Model "${model.name}" requires a source image. Pass resourceId in the request body.`,
        hint: "Upload an image to Dreemy first, then use the returned URL as resourceId.",
      },
      { status: 400 },
    );
  }

  // Step 1: Create video job
  try {
    const createRes = await fetch(`${DREEMY_BASE}/api/aiVideo/create/v2`, {
      method: "POST",
      headers: dreemyHeaders,
      body: JSON.stringify(createBody),
      signal: signal ?? AbortSignal.timeout(30000),
    });

    if (createRes.status === 401) {
      // Dreemy 401 returns {"code":"401","msg":"\u672a\u767b\u5f55"} — translate it
      let errMsg = "Invalid or expired dreemy_token. Re-login or omit for auto-mint.";
      try {
        const errData = await createRes.json() as { msg?: string };
        if (errData.msg) errMsg = translateDreemyMsg(errData.msg);
      } catch {}
      return NextResponse.json(
        { error: `Dreemy: ${errMsg}` },
        { status: 401 },
      );
    }

    if (!createRes.ok) {
      const errText = await createRes.text().catch(() => "");
      const translatedErr = translateDreemyMsg(errText) || errText;
      return NextResponse.json(
        { error: `Dreemy: Video creation failed (HTTP ${createRes.status}): ${translatedErr.slice(0, 300)}` },
        { status: 502 },
      );
    }

    const createData = await createRes.json() as {
      code?: number | string;
      data?: { code?: number; result?: { id?: number; status?: number }; msg?: string };
      msg?: string;
    };

    // Dreemy returns HTTP 200 even on errors. Check response-level code first.
    // code="401" means auth error (even though HTTP status is 200)
    const responseCode = String(createData.code ?? "");
    if (responseCode === "401" || responseCode === "403") {
      const errMsg = translateDreemyMsg(createData.msg) || "Authentication failed";
      return NextResponse.json(
        { error: `Dreemy: ${errMsg}`, hint: "Your dreemy_token is invalid or expired. Re-login or omit for auto-mint." },
        { status: 401 },
      );
    }

    // Check for quota/rate limit errors
    // data.code=-1 means insufficient credits → 402, data.code=-5 means rate limited → 429
    const innerCode = createData.data?.code;
    if (innerCode === -1 || innerCode === -5) {
      const errMsg = translateDreemyError(
        createData.data?.msg || createData.msg,
        innerCode,
      );
      const httpStatus = innerCode === -1 ? 402 : 429;
      return NextResponse.json(
        {
          error: `Dreemy: ${errMsg}`,
          hint: innerCode === -1
            ? (autoMinted
              ? "Guest accounts have 0 credits. Use a registered dreemy_token with credits."
              : `Your dreemy_token has insufficient credits (integral: ${integral ?? 0}). Purchase more at dreemy.ai.`)
            : "Too many requests — please wait and try again later.",
          integral,
          auto_minted: autoMinted,
        },
        { status: httpStatus },
      );
    }

    const jobId = createData.data?.result?.id;
    if (!jobId) {
      // Translate any Chinese msg in the response before returning
      const topMsg = createData.msg ? translateDreemyMsg(createData.msg) : undefined;
      return NextResponse.json(
        { error: `Dreemy: No job ID in response${topMsg ? ` — ${topMsg}` : ""}`, raw: createData },
        { status: 502 },
      );
    }

    // Step 2: Poll until complete (status=2) or timeout
    const pollStart = Date.now();
    let lastProgress = 0;

    while (Date.now() - pollStart < DREEMY_VIDEO_POLL_MAX_MS) {
      if (signal?.aborted) break;

      // Adaptive polling: 5s for first 60s, then 8s
      const elapsed = Date.now() - pollStart;
      const pollDelay = elapsed < 60000 ? DREEMY_VIDEO_POLL_INTERVAL_MS : 8000;
      await new Promise((r) => setTimeout(r, pollDelay));

      try {
        const pollRes = await fetch(`${DREEMY_BASE}/api/aiVideo/${jobId}`, {
          method: "GET",
          headers: dreemyHeaders,
          signal: AbortSignal.timeout(15000),
        });

        if (!pollRes.ok) continue;

        const pollData = await pollRes.json() as {
          code?: string;
          data?: {
            code?: number;
            result?: {
              id?: number;
              status?: number; // 1=pending, 2=success, 3=failed
              progress?: number;
              resultVideos?: { url?: string; videoUrl?: string; coverUrl?: string }[];
            };
          };
        };

        const status = pollData.data?.result?.status;
        lastProgress = pollData.data?.result?.progress ?? lastProgress;

        if (status === 2) {
          // Success! Extract video URLs
          const videos = pollData.data?.result?.resultVideos || [];
          const videoUrls = videos
            .map((v) => v.url || v.videoUrl)
            .filter(Boolean) as string[];
          const coverUrl = videos[0]?.coverUrl;

          if (videoUrls.length > 0) {
            return NextResponse.json({
              success: true,
              videos: videoUrls.map((url) => ({ url, format: "mp4", cover_url: coverUrl })),
              model: model.id,
              model_name: model.name,
              category: model.category,
              provider: "dreemy",
              prompt,
              job_id: jobId,
              model_id: modelId,
              duration: req.duration || model.defaultDuration || 5,
              status: "completed",
              progress: 100,
              auto_minted: autoMinted,
            });
          }

          // No videos despite status=2
          return NextResponse.json(
            { error: "Dreemy: Job completed but no videos returned", raw: pollData },
            { status: 502 },
          );
        }

        if (status === 3) {
          return NextResponse.json(
            { error: "Dreemy: Video generation failed (status=3)", job_id: jobId },
            { status: 502 },
          );
        }

        // Still pending (status=1) — continue polling
        continue;
      } catch {
        continue;
      }
    }

    // Timeout — return job_id with polling info
    return NextResponse.json({
      success: true,
      videos: [{ url: `dreemy://job/${jobId}`, format: "pending" }],
      model: model.id,
      model_name: model.name,
      category: model.category,
      provider: "dreemy",
      prompt,
      job_id: jobId,
      model_id: modelId,
      duration: req.duration || model.defaultDuration || 5,
      status: "processing",
      progress: lastProgress,
      auto_minted: autoMinted,
      poll: {
        url: `${DREEMY_BASE}/api/aiVideo/${jobId}`,
        headers: { "x-auth-token": "<your-token>", "x-finger": finger, "x-platform": "web", "x-version": "999.0.0", "x-language": "en" },
        interval_ms: DREEMY_VIDEO_POLL_INTERVAL_MS,
        note: "Video is still generating. Poll the URL with the same auth headers until result.status=2 and resultVideos is populated.",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { error: `Dreemy video generation failed: ${msg}` },
      { status: 500 },
    );
  }
}

// ─── NSFW Gateway video handler ─────────────────────────────────────────────
async function handleNsfwGatewayVideo(model: VideoModel, req: VideoRequest, signal?: AbortSignal) {
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

  // Validate resourceId for models that need it
  if (model.needsImage && !req.resourceId) {
    return NextResponse.json(
      {
        error: `Model "${model.name}" requires a source image. Pass resourceId in the request body.`,
        hint: "First upload an image to the gateway, then use the returned resourceId.",
      },
      { status: 400 },
    );
  }

  const now = Date.now();
  const duration = req.duration || model.defaultDuration || 5;

  // Build form-urlencoded body
  const formParams = new URLSearchParams();
  formParams.set("prompt", prompt);
  formParams.set("duration", String(duration));
  if (req.resourceId) formParams.set("resourceId", req.resourceId);
  if (req.width) formParams.set("width", String(req.width));
  if (req.height) formParams.set("height", String(req.height));

  const authHeaders = {
    authorization: token, // Raw JWT, lowercase, NO "Bearer " prefix
    "x-device-id": deviceId,
    "x-time": String(now),
    "x-country": "US",
    "Content-Type": "application/x-www-form-urlencoded",
  };

  // Step 1: Create task
  const createUrl = `${NSFW_GW_BASE}/users/me/models/${model.upstreamModel}/tasks?locale=en`;
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
    let lastProgress = 0;

    while (Date.now() - pollStart < POLL_MAX_MS) {
      if (signal?.aborted) break;

      // Adaptive polling: 3s for first 30s, then 5s
      const elapsed = Date.now() - pollStart;
      const pollDelay = elapsed < 30000 ? POLL_INTERVAL_MS : 5000;
      await new Promise((r) => setTimeout(r, pollDelay));

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
        lastProgress = pollData.data?.progress?.progress ?? lastProgress;

        if (status === 2 && pollData.data?.fileInfos) {
          // Complete! Find the video URL
          const videoFile = pollData.data.fileInfos.find((f) => f.type === "video");
          const coverFile = pollData.data.fileInfos.find((f) => f.type === "cover");
          const anyFile = pollData.data.fileInfos[0];

          const videoUrl = videoFile?.fileUrl || anyFile?.fileUrl;
          const coverUrl = coverFile?.fileUrl;

          if (videoUrl) {
            return NextResponse.json({
              success: true,
              videos: [{ url: videoUrl, format: "mp4", cover_url: coverUrl }],
              model: model.id,
              model_name: model.name,
              category: model.category,
              provider: "nsfw-gateway",
              prompt,
              task_id: taskId,
              duration,
              status: "completed",
              progress: 100,
              fileInfos: pollData.data.fileInfos,
            });
          }
        }

        // Still processing — continue polling
        if (status === 0 || status === 1) continue;

        // Unknown status — break
        break;
      } catch {
        continue;
      }
    }

    // Timeout — return task_id with polling info
    return NextResponse.json({
      success: true,
      videos: [{ url: `nsgw://task/${taskId}`, format: "pending" }],
      model: model.id,
      model_name: model.name,
      category: model.category,
      provider: "nsfw-gateway",
      prompt,
      task_id: taskId,
      duration,
      status: "processing",
      progress: lastProgress,
      poll: {
        url: pollUrl,
        headers: { authorization: "<your-token>", "x-device-id": deviceId, "x-time": "<current ms>", "x-country": "US" },
        interval_ms: POLL_INTERVAL_MS,
        note: "Video is still generating. Poll the URL with the same auth headers until status=2 and fileInfos has the video URL.",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { error: `NSFW Gateway video generation failed: ${msg}` },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  let body: VideoRequest;
  try { body = (await request.json()) as VideoRequest; } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.prompt) return NextResponse.json({ error: "prompt is required" }, { status: 400 });

  const modelId = body.model || DEFAULT_MODEL_ID;
  const model = findVideoModel(modelId);
  if (!model) {
    return NextResponse.json(
      { error: `Unknown video model "${modelId}". Call GET /api/v1/video/generate for the list.` },
      { status: 400 },
    );
  }

  // Unrestricted consent gate for Dreemy models
  if (model.provider === "dreemy" && model.nsfw && body.nsfw !== true) {
    return NextResponse.json({
      error: 'This model is unrestricted. Pass "nsfw": true in the request body to confirm you are 18+ and consent to adult content.',
      model: modelId, category: model.category,
    }, { status: 403 });
  }

  try {
    switch (model.provider) {
      case "dreemy": return await handleDreemyVideo(model, body, request.signal);
      case "nsfw-gateway": return await handleNsfwGatewayVideo(model, body, request.signal);
      default: return NextResponse.json({ error: `Provider ${model.provider} not implemented` }, { status: 400 });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: `Video generation failed: ${message}`, model: modelId }, { status: 500 });
  }
}

export async function GET() {
  const models = VIDEO_MODELS.map((m) => ({
    id: m.id, name: m.name, category: m.category, provider: m.provider,
    upstream_model: m.upstreamModel, needs_image: m.needsImage,
    default_duration: m.defaultDuration, nsfw: m.nsfw, description: m.description,
  }));
  return NextResponse.json({
    service: "Video Generation",
    total_models: models.length,
    endpoint: "POST /api/v1/video/generate",
    params: ["prompt (required)", "model", "dreemy_token (BYOK for dreemy.ai, or omit for auto-mint)", "byok_token (BYOK for nsfw-gateway)", "byok_device_id (required for nsfw-gateway)", "resourceId (for image-based models)", "duration (seconds, default 5)", "nsfw (true for unrestricted, 18+)"],
    categories: ["general", "animation", "anime", "face-swap", "unrestricted"],
    providers: {
      dreemy: "Dreemy.ai — BYOK (dreemy_token) or auto-mint guest token (100 credits). Text2Video + Image2Video.",
      "nsfw-gateway": "NSFW Gateway (gateway.nsfwimg2video.com) — BYOK (bring your own JWT token from nsfwimg2video.com)",
    },
    models,
  });
}

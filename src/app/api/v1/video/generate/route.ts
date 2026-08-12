/**
 * Video Generation API — NSFW Gateway BYOK
 *
 * Provider: nsfw-gateway (gateway.nsfwimg2video.com)
 * Auth: BYOK — user provides JWT token + device-id
 * CORS: * — browser can call directly, server-side also supported
 *
 * Endpoint: POST /api/v1/video/generate
 * Body: { prompt, model, byok_token, byok_device_id, resourceId?, duration? }
 *
 * Models: text2video, image2video, anime-girl, fast-face-swap
 * Task pattern: POST create → GET poll → fileInfos with video URL
 */

import { NextRequest, NextResponse } from "next/server";
import {
  VIDEO_MODELS,
  findVideoModel,
  type VideoModel,
} from "@/lib/providers/video-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface VideoRequest {
  prompt?: string;
  model?: string;
  byok_token?: string; // JWT token from nsfwimg2video.com
  byok_device_id?: string; // Device ID from nsfwimg2video.com
  resourceId?: string; // Source image resource ID (for image2video, anime-girl, face-swap)
  duration?: number; // Video duration in seconds (default 5)
  width?: number;
  height?: number;
}

const DEFAULT_MODEL_ID = "nsgw-text2video";
const NSFW_GW_BASE = "https://gateway.nsfwimg2video.com/web";
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_MS = 300000; // 5 min max — videos take longer than images

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

  try {
    switch (model.provider) {
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
    params: ["prompt (required)", "model", "byok_token (required)", "byok_device_id (required)", "resourceId (for image-based models)", "duration (seconds, default 5)"],
    categories: ["general", "animation", "anime", "face-swap"],
    providers: "NSFW Gateway (gateway.nsfwimg2video.com) — BYOK (bring your own JWT token from nsfwimg2video.com)",
    models,
  });
}

/**
 * OpenAI-compatible video generation — POST /api/v1/videos/generations
 *
 * Routes to the upstream Gratisfy BYOK endpoint
 * `https://api.gratisfy.xyz/v1/videos/generations` using the user's
 * Gratisfy key from the X-Gratisfy-API-Key header (PRIVACY-MODE).
 *
 * Body (OpenAI-compatible):
 *   { model: "gratisfy:<provider>:<upstreamId>", prompt, n?, size?,
 *     duration?, quality?, response_format? }
 *
 * Replaces the previous 503 stub at /api/v1/video/generate which had no
 * provider routing. This endpoint dispatches to Gratisfy's video models
 * (e.g. nova-reel, qwen-video, x-ai/grok-imagine-video-1.5-preview).
 */
import { NextRequest } from "next/server";
import { forwardByokGeneration } from "@/lib/xyz/byok-generation";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return new Response(
      JSON.stringify({ error: { type: "invalid_request", message: "Invalid JSON body." } }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }
  const modelId = String(body.model ?? "");
  if (!modelId) {
    return new Response(
      JSON.stringify({ error: { type: "invalid_request", message: "Missing `model` field." } }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }
  const apiKey = req.headers.get("x-gratisfy-api-key") ?? "";
  const pollinationsToken = req.headers.get("x-pollinations-api-key") ?? undefined;
  const { model: _omit, ...rest } = body;
  void _omit;
  return forwardByokGeneration({
    modelId,
    apiKey,
    pollinationsToken,
    upstreamPath: "/videos/generations",
    body: rest,
  });
}

export async function GET() {
  return new Response(
    JSON.stringify({
      object: "endpoint",
      method: "POST",
      path: "/api/v1/videos/generations",
      description: "OpenAI-compatible video generation. Routes to Gratisfy BYOK upstream. Requires X-Gratisfy-API-Key header + a gratisfy:* video model (e.g. nova-reel, qwen-video).",
      note: "Replaces the previous 503 stub at /api/v1/video/generate. Pollen-priced models additionally require X-Pollinations-API-Key.",
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

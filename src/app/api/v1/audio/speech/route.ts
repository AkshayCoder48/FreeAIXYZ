/**
 * OpenAI-compatible text-to-speech — POST /api/v1/audio/speech
 *
 * Routes to the upstream Gratisfy BYOK endpoint
 * `https://api.gratisfy.xyz/v1/audio/speech` using the user's Gratisfy
 * key from the X-Gratisfy-API-Key header (PRIVACY-MODE).
 *
 * Body (OpenAI shape):
 *   { model: "gratisfy:<provider>:<upstreamId>", input, voice?,
 *     response_format?, speed? }
 *
 * Returns: binary audio (audio/mpeg by default, per upstream content-type).
 */
import { NextRequest } from "next/server";
import { forwardByokGeneration } from "@/lib/xyz/byok-generation";

export const runtime = "nodejs";
export const maxDuration = 60;

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
    upstreamPath: "/audio/speech",
    body: rest,
  });
}

export async function GET() {
  return new Response(
    JSON.stringify({
      object: "endpoint",
      method: "POST",
      path: "/api/v1/audio/speech",
      description: "OpenAI-compatible text-to-speech. Routes to Gratisfy BYOK upstream. Requires X-Gratisfy-API-Key header + a gratisfy:* audio/tts model (e.g. @cf/myshell-ai/melotts).",
      note: "Returns binary audio. Pollen-priced models additionally require X-Pollinations-API-Key.",
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

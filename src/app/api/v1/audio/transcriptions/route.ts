/**
 * OpenAI-compatible audio transcription — POST /api/v1/audio/transcriptions
 *
 * Routes to the upstream Gratisfy BYOK endpoint
 * `https://api.gratisfy.xyz/v1/audio/transcriptions` using the user's
 * Gratisfy key from the X-Gratisfy-API-Key header (PRIVACY-MODE).
 *
 * Accepts multipart/form-data (audio file + model + optional params) and
 * forwards it upstream as multipart. Returns the transcribed text in the
 * upstream's JSON shape.
 */
import { NextRequest } from "next/server";
import { GRATISFY_BASE_URL } from "@/lib/xyz/gratisfy";
import { parseByokModelId, buildUpstreamModelId } from "@/lib/xyz/byok-generation";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("x-gratisfy-api-key") ?? "";
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: { type: "authentication", message: "A Gratisfy BYOK key is required (X-Gratisfy-API-Key header)." } }),
      { status: 401, headers: { "content-type": "application/json" } },
    );
  }
  const formData = await req.formData();
  const modelId = String(formData.get("model") ?? "");
  if (!modelId) {
    return new Response(
      JSON.stringify({ error: { type: "invalid_request", message: "Missing `model` field." } }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }
  const parsed = parseByokModelId(modelId);
  if (!parsed || parsed.source !== "gratisfy") {
    return new Response(
      JSON.stringify({ error: { type: "invalid_request", message: `Model "${modelId}" is not a Gratisfy BYOK model.` } }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }
  // Reconstruct prefixed upstream id + rewrite the model field in the form.
  const upstreamModel = buildUpstreamModelId(parsed.provider, parsed.model);
  const upstreamForm = new FormData();
  for (const [key, value] of formData.entries()) {
    if (key === "model") {
      upstreamForm.set("model", upstreamModel);
    } else {
      upstreamForm.append(key, value);
    }
  }
  if (!upstreamForm.get("model")) upstreamForm.set("model", upstreamModel);

  const upstreamRes = await fetch(`${GRATISFY_BASE_URL}/audio/transcriptions`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}` },
    body: upstreamForm,
  });
  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers: { "content-type": upstreamRes.headers.get("content-type") ?? "application/json" },
  });
}

export async function GET() {
  return new Response(
    JSON.stringify({
      object: "endpoint",
      method: "POST",
      path: "/api/v1/audio/transcriptions",
      description: "OpenAI-compatible audio transcription. Routes to Gratisfy BYOK upstream. Accepts multipart/form-data (file + model). Requires X-Gratisfy-API-Key.",
      note: "Use a gratisfy:* transcription model (e.g. whisper-large-v3-turbo, gpt-4o-transcribe).",
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

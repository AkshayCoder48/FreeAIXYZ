import { NextResponse } from "next/server";
import { MODELS } from "@/lib/providers";
import type { OAIModelList } from "@/lib/openai-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CREATED = Math.floor(Date.now() / 1000);

/** GET /api/v1/models — OpenAI-compatible model listing. */
export async function GET() {
  const payload: OAIModelList = {
    object: "list",
    data: MODELS.map((m) => ({
      id: m.id,
      object: "model",
      created: CREATED,
      owned_by: m.provider,
    })),
  };
  return NextResponse.json(payload);
}

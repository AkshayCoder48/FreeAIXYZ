import { NextResponse } from "next/server";
import { TOOLBAZ_MODELS } from "@/lib/toolbaz";
import type { OAIModelList } from "@/lib/openai-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CREATED = Math.floor(Date.now() / 1000);

/** GET /api/v1/models — OpenAI-compatible model listing. */
export async function GET() {
  const payload: OAIModelList = {
    object: "list",
    data: TOOLBAZ_MODELS.map((m) => ({
      id: m.id,
      object: "model",
      created: CREATED,
      owned_by: "free-gpt-gateway",
    })),
  };
  return NextResponse.json(payload);
}

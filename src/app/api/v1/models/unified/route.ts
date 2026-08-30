/**
 * GET /api/v1/models/unified — unified model list (PRD §57).
 * Auth OPTIONAL. Returns OpenAI-shaped `data[]` across native + g4f + (if
 * authed) gratisfy sources. Same model from different sources stays
 * independent (PRD §2).
 */

import { getUnifiedModels, getSessionUserId } from "@/lib/xyz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const userId = await getSessionUserId(request);
  const { models, stale } = await getUnifiedModels(userId ?? undefined);
  return Response.json({
    object: "list",
    data: models.map((m) => ({
      id: m.id,
      object: "model",
      source: m.source,
      provider: m.provider,
      displayName: m.displayName,
      originalModelId: m.originalModelId,
      streaming: m.streaming,
      available: m.available,
      capabilities: m.capabilities,
      pricing: m.pricing,
    })),
    stale,
  });
}

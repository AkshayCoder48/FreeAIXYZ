/**
 * GET /api/v1/models/unified — unified model list (PRD §57).
 * Auth OPTIONAL. Returns OpenAI-shaped `data[]` across native +
 * gratisfy + pollinations sources. Same model from different sources
 * stays independent (PRD §2).
 */

import { getUnifiedModels, getSessionUserId } from "@/lib/xyz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

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
      // PRD §5, §6, §16, §17 — access classification so the UI can show a
      // FREE / PAID / FREEMIUM / UNKNOWN badge on every card and support a
      // strict Free-Only filter. `accessReason` powers the tooltip.
      access: m.access,
      accessReason: m.accessReason,
      metadataConfidence: m.metadataConfidence,
    })),
    stale,
  });
}

/**
 * GET /api/v1/providers — unified provider list (PRD §56).
 * Auth OPTIONAL: Gratisfy providers are only included when the caller has a
 * connected key (per-user discovery is auth-gated — PRD §11, §54).
 */

import { getUnifiedModels, getSessionUserId } from "@/lib/xyz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  const userId = await getSessionUserId(request);
  const { providers, stale } = await getUnifiedModels(userId ?? undefined);
  return Response.json({
    providers: providers.map((p) => ({
      id: p.id,
      name: p.name,
      source: p.source,
      requiresApiKey: p.requiresApiKey,
      supportsModelDiscovery: p.supportsModelDiscovery,
      supportsStreaming: p.supportsStreaming,
      capabilities: p.capabilities,
      modelCount: p.models.length,
      lastDiscoveredAt: p.lastDiscoveredAt,
    })),
    stale,
  });
}

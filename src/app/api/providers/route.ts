/**
 * GET /api/providers — extended provider listing (PRD §88, §218).
 *
 * Returns one entry per registered provider with: status, model count,
 * streaming/image model counts, last discovery + health-check timestamps,
 * and recent latency.
 *
 * Used by the admin UI to render the provider grid.
 */

import {
  catalogStore,
  errorResponse,
  GatewayError,
  providerRegistry,
  type DiscoveredModel,
  type ProviderAdapter,
} from "@/lib/gateway";
import { ensureGateway } from "@/lib/gateway/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface ProviderEntry {
  id: string;
  shortId: string;
  name: string;
  status: string;
  models: number;
  streamingModels: number;
  imageModels: number;
  lastDiscovery?: string;
  lastHealthCheck?: string;
  latencyMs?: number;
}

/** GET /api/providers. */
export async function GET() {
  await ensureGateway();
  try {
    const adapters = providerRegistry.list();
    const { models, lastUpdated } = catalogStore.getCatalog();
    const entries: ProviderEntry[] = adapters.map((a: ProviderAdapter) =>
      buildProviderEntry(a, models, lastUpdated),
    );
    return Response.json({ providers: entries });
  } catch (err) {
    const ge =
      err instanceof GatewayError
        ? err
        : new GatewayError({
            type: "PROVIDER_UNAVAILABLE",
            message: err instanceof Error ? err.message : String(err),
          });
    return errorResponse(ge);
  }
}

function buildProviderEntry(
  adapter: ProviderAdapter,
  models: DiscoveredModel[],
  lastUpdated: string,
): ProviderEntry {
  const providerModels = models.filter((m) => m.providerId === adapter.id);
  const health = catalogStore.getProviderHealth(adapter.id);
  return {
    id: adapter.id,
    shortId: adapter.shortId,
    name: adapter.name,
    status: health?.status ?? "unknown",
    models: providerModels.length,
    streamingModels: providerModels.filter((m) => m.capabilities.streaming).length,
    imageModels: providerModels.filter((m) => m.capabilities.image).length,
    lastDiscovery: lastUpdated,
    lastHealthCheck: health?.lastChecked,
    latencyMs: health?.latencyMs,
  };
}

/**
 * GET /health — application health probe.
 *
 * Returns:
 *   {
 *     application: "ok",
 *     providers: { healthy: N, degraded: M, offline: K, total: number },
 *     catalog: "ok" | "stale",
 *     ready: boolean
 *   }
 *
 * Providers: aggregate counts from the in-memory static catalog + circuit
 * breakers. There is no database — the app is fully stateless.
 */

import { catalogStore, providerRegistry } from "@/lib/gateway";
import { ensureGateway } from "@/lib/gateway/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

interface HealthResponse {
  application: "ok";
  providers: { healthy: number; degraded: number; offline: number; total: number };
  catalog: "ok" | "stale";
  ready: boolean;
}

/** GET /health. */
export async function GET() {
  await ensureGateway();

  // Provider aggregates — best-effort.
  let healthy = 0;
  let degraded = 0;
  let offline = 0;
  let total = 0;
  try {
    const adapters = providerRegistry.list();
    total = adapters.length;
    for (const a of adapters) {
      const health = catalogStore.getProviderHealth(a.id);
      const status = health?.status ?? "unknown";
      if (status === "healthy") healthy += 1;
      else if (status === "degraded") degraded += 1;
      else if (status === "offline") offline += 1;
    }
  } catch (err) {
    console.error("[/health] provider aggregate failed:", err);
  }

  // Catalog freshness.
  let catalog: "ok" | "stale" = "ok";
  try {
    if (catalogStore.getCatalog().catalogStale) catalog = "stale";
  } catch {
    catalog = "stale";
  }

  // "ready" = the catalog has at least one model.
  const ready = catalogStore.getCatalog().models.length > 0;

  const payload: HealthResponse = {
    application: "ok",
    providers: { healthy, degraded, offline, total },
    catalog,
    ready,
  };
  return Response.json(payload);
}

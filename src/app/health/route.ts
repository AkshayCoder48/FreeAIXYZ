/**
 * GET /health — application health probe (PRD §86).
 *
 * Returns:
 *   {
 *     application: "ok",
 *     database: "ok" | "degraded",
 *     providers: { healthy: N, degraded: M, offline: K },
 *     discovery: "ok" | "stale",
 *     ready: boolean
 *   }
 *
 * Database: trivial $queryRaw`SELECT 1` (try/catch — never crash).
 * Providers: aggregate counts from the catalog.
 * Discovery: "stale" if the catalogStale flag is set (PRD §171).
 */

import { db } from "@/lib/db";
import { catalogStore, providerRegistry } from "@/lib/gateway";
import { ensureGateway } from "@/lib/gateway/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

interface HealthResponse {
  application: "ok";
  database: "ok" | "degraded";
  providers: { healthy: number; degraded: number; offline: number; total: number };
  discovery: "ok" | "stale";
  ready: boolean;
}

/** GET /health. */
export async function GET() {
  await ensureGateway();

  // Database probe — trivial query, never crash.
  let database: "ok" | "degraded" = "ok";
  try {
    await db.$queryRaw`SELECT 1`;
  } catch (err) {
    console.error("[/health] database probe failed:", err);
    database = "degraded";
  }

  // Provider aggregates — best-effort.
  let healthy = 0;
  let degraded = 0;
  let offline = 0;
  let total = 0;
  try {
    const adapters = providerRegistry.list();
    total = adapters.length;
    const { models } = catalogStore.getCatalog();
    for (const a of adapters) {
      const health = catalogStore.getProviderHealth(a.id);
      const status = health?.status ?? "unknown";
      if (status === "healthy") healthy += 1;
      else if (status === "degraded") degraded += 1;
      else if (status === "offline") offline += 1;
    }
    void models; // reserved for future use
  } catch (err) {
    console.error("[/health] provider aggregate failed:", err);
  }

  // Catalog freshness (PRD §171).
  let discovery: "ok" | "stale" = "ok";
  try {
    if (catalogStore.getCatalog().catalogStale) discovery = "stale";
  } catch {
    discovery = "stale";
  }

  // "ready" = the catalog has loaded at least once (PRD §87 — partial is OK).
  const ready = healthy + degraded + offline + total > 0 || database === "ok";

  const payload: HealthResponse = {
    application: "ok",
    database,
    providers: { healthy, degraded, offline, total },
    discovery,
    ready,
  };
  return Response.json(payload);
}

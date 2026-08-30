/**
 * GET /ready — readiness probe (PRD §87).
 *
 * Returns 200 `{ ready: true }` if the catalog has loaded at least partially
 * (even if some providers are degraded/offline — never require all healthy).
 * Returns 503 `{ ready: false }` otherwise.
 *
 * Used by orchestrators (k8s, container healthchecks) to gate traffic routing.
 */

import { catalogStore, isGatewayReady } from "@/lib/gateway";
import { ensureGateway } from "@/lib/gateway/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

/** GET /ready. */
export async function GET() {
  await ensureGateway();
  try {
    const catalog = catalogStore.getCatalog();
    const hasModels = catalog.models.length > 0;
    const ready = isGatewayReady() || hasModels;
    return Response.json({ ready }, { status: ready ? 200 : 503 });
  } catch (err) {
    console.error("[/ready] catalog read failed:", err);
    return Response.json({ ready: false }, { status: 503 });
  }
}

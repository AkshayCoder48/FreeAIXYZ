/**
 * GET /api/metrics — gateway metrics snapshot (PRD §115).
 *
 * Returns the rolling 1000-request ring buffer aggregates + recent stream
 * timings. Used by the admin/debug UI to surface TTFT, error rate, and
 * per-provider failure counts.
 */

import { errorResponse, GatewayError, metricsService } from "@/lib/gateway";
import { ensureGateway } from "@/lib/gateway/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

/** GET /api/metrics. */
export async function GET() {
  await ensureGateway();
  try {
    const metrics = metricsService.getMetrics();
    const streamTimings = metricsService.getStreamTimings();
    return Response.json({
      metrics,
      streamTimings,
    });
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

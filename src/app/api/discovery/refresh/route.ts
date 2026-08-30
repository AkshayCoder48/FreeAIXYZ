/**
 * POST /api/discovery/refresh — manual discovery trigger (PRD §113, §173).
 *
 * Body (optional):
 *   { provider?: string }   — limit refresh to one provider id (or short id)
 *
 * With no body or empty `provider`: runs discoverAll() across every
 * registered provider in parallel (15s per-provider timeout — PRD §29).
 * With a `provider` field: runs discoverProvider(providerId) only.
 *
 * Returns the DiscoveryResult[] (or a single DiscoveryResult) for the run.
 * Never crashes — unknown providers return a structured error.
 */

import {
  errorResponse,
  GatewayError,
  modelDiscoveryService,
  providerRegistry,
  type DiscoveryResult,
} from "@/lib/gateway";
import { ensureGateway } from "@/lib/gateway/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface RefreshBody {
  provider?: string;
}

/** POST /api/discovery/refresh. */
export async function POST(request: Request) {
  await ensureGateway();
  let body: RefreshBody = {};
  try {
    const text = await request.text();
    if (text.trim()) body = JSON.parse(text) as RefreshBody;
  } catch {
    // empty/invalid body is fine — default to discoverAll()
  }
  try {
    const providerArg = body.provider?.trim();
    if (providerArg) {
      // Resolve shortId → full providerId if needed.
      const providerId =
        providerRegistry.resolveShortId(providerArg) ?? providerArg;
      const adapter = providerRegistry.get(providerId);
      if (!adapter) {
        return errorResponse(
          new GatewayError({
            type: "PROVIDER_NOT_FOUND",
            message: `Unknown provider "${providerArg}".`,
            provider: providerId,
          }),
        );
      }
      const result = await modelDiscoveryService.discoverProvider(providerId);
      return Response.json({ ok: true, results: [result] satisfies DiscoveryResult[] });
    }
    const results = await modelDiscoveryService.discoverAll();
    return Response.json({ ok: true, results });
  } catch (err) {
    const ge =
      err instanceof GatewayError
        ? err
        : new GatewayError({
            type: "DISCOVERY_FAILED",
            message: err instanceof Error ? err.message : String(err),
          });
    return errorResponse(ge);
  }
}

/** GET /api/discovery/refresh — quick status (no-op trigger, just shows ready state). */
export async function GET() {
  await ensureGateway();
  return Response.json({ ok: true, message: "POST to trigger discovery." });
}

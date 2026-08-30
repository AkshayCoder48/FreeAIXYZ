/**
 * GET /api/v1/pricing — central pricing board (PRD §58, §23).
 * PUBLIC. Returns the supplied baseline + version + multiplier + reference
 * request for the "responses per XYZ" estimate (PRD §33).
 */

import {
  getSuppliedPricingBoard,
  getPricingVersion,
  XYZ_USD_MULTIPLIER,
  REFERENCE_REQUEST,
} from "@/lib/xyz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const version = getPricingVersion();
  return Response.json({
    version: version.version,
    currency: "USD",
    multiplier: XYZ_USD_MULTIPLIER,
    referenceRequest: REFERENCE_REQUEST,
    updatedAt: version.updatedAt,
    models: getSuppliedPricingBoard(),
  });
}

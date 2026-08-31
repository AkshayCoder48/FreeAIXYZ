/**
 * GET /api/v1/pricing/credit-systems
 *
 * Lists all currency/credit systems the gateway recognises across the
 * Gratisfy + Pollinations catalogs, with their 1-XYZ conversion.
 *
 * User directive: "there are more credit system from different gratisfy
 * providers calculated them on basis of 1xyz=? Okay and list them".
 */
import { CREDIT_SYSTEMS } from "@/lib/xyz/credit-systems";
import { XYZ_USD_MULTIPLIER, POLLEN_XYZ_PEG } from "@/lib/xyz/pricing-board";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return new Response(
    JSON.stringify({
      object: "list",
      xyz_base: "1 XYZ = 1 USD (XYZ_USD_MULTIPLIER, default 1)",
      pollen_peg: `1 pollen = ${POLLEN_XYZ_PEG} XYZ (POLLEN_XYZ_PEG)`,
      multiplier: XYZ_USD_MULTIPLIER,
      count: CREDIT_SYSTEMS.length,
      data: CREDIT_SYSTEMS,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

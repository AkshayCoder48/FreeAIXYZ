/**
 * GET /api/v1/xyz/balance — user balance + idempotent daily +1 grant (PRD §59, §21, §96).
 * AUTH REQUIRED.
 */

import { getBalance, grantDailyXYZ } from "@/lib/xyz";
import { requireAuth } from "@/lib/xyz/route-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if ("response" in auth) return auth.response;
  const { userId } = auth;
  const { balance, granted } = await grantDailyXYZ(userId);
  return Response.json({ balance, granted });
}

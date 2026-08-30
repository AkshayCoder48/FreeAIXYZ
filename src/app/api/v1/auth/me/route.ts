/**
 * GET /api/v1/auth/me — current authenticated user (PRD §94, §90).
 * PUBLIC. Returns `{ user: null }` when unauthenticated (no error — lets the
 * client render the unauthenticated state without a 401).
 */

import { getSessionUserId, getAccount } from "@/lib/xyz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const userId = await getSessionUserId(request);
  if (!userId) return Response.json({ user: null });
  const account = await getAccount(userId);
  return Response.json({ user: account });
}

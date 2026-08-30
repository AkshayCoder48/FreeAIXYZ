/**
 * GET /api/v1/xyz/usage — user usage records (PRD §38, §68).
 * AUTH REQUIRED. ?limit=50 (max 500).
 */

import { getUsage } from "@/lib/xyz";
import { requireAuth } from "@/lib/xyz/route-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if ("response" in auth) return auth.response;
  const url = new URL(request.url);
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? "50")));
  const usage = await getUsage(auth.userId, limit);
  return Response.json({ usage });
}

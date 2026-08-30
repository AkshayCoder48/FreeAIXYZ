/**
 * POST /api/v1/auth/logout — invalidate session + clear cookie (PRD §93).
 * PUBLIC. Does NOT delete account data (XYZ, usage, BYOK).
 */

import { logout, buildClearCookie } from "@/lib/xyz";
import { isSecure } from "@/lib/xyz/route-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  await logout(request);
  const cookie = buildClearCookie(isSecure(request));
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": cookie,
    },
  });
}

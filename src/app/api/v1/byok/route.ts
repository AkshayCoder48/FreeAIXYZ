/**
 * GET /api/v1/byok — masked metadata for ALL of the signed-in user's BYOK
 * keys (gratisfy, g4f, pollinations). Requires a session.
 *
 * This is what the Providers page calls on mount to show the user's saved
 * (masked) keys after a refresh / tab change — the keys live in OnyxBase
 * keyed by userId, so they persist with the account.
 *
 * Never returns raw keys. Never 401s for missing keys — returns
 * `{ connected: false }` for each unconnected provider.
 */

import { getBYOKMeta } from "@/lib/xyz";
import { requireAuth } from "@/lib/xyz/route-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if ("response" in auth) return auth.response;
  const meta = await getBYOKMeta(auth.userId);
  return Response.json({ ok: true, meta });
}

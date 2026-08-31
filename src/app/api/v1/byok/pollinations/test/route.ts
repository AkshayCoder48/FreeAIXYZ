/**
 * POST /api/v1/byok/pollinations/test — validate a Pollinations token
 * (PRIVACY-MODE). Body `{ key: string }`. Requires a signed-in user.
 * The client MUST supply the token in the body — the server never
 * persists it.
 */

import { validatePollinationsKey } from "@/lib/xyz/pollinations";
import { requireAuth } from "@/lib/xyz/route-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if ("response" in auth) return auth.response;
  let body: { key?: string } = {};
  try {
    body = (await request.json()) as { key?: string };
  } catch {
    // empty body — fall through to "no token"
  }
  const key = (body.key ?? "").trim();
  if (!key) {
    return Response.json(
      { ok: false, error: "No token to test. Provide one in the request body." },
      { status: 400 },
    );
  }
  const result = await validatePollinationsKey(key);
  return Response.json(result, { status: result.ok ? 200 : 400 });
}

/**
 * POST /api/v1/byok/pollinations/test — validate a Pollinations token.
 * Body `{ key?: string }`. Requires a signed-in user. If `key` provided,
 * test THAT; else test the stored token for this user.
 */

import { loadBYOKKey, setBYOKValidation } from "@/lib/xyz";
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
    // empty body is fine — fall through to stored token
  }
  const bodyKey = (body.key ?? "").trim();
  const stored = (await loadBYOKKey(auth.userId, "pollinations")) ?? "";
  const key = bodyKey || stored;
  if (!key) {
    return Response.json(
      { ok: false, error: "No token to test. Save one first." },
      { status: 400 },
    );
  }
  const result = await validatePollinationsKey(key);
  await setBYOKValidation(auth.userId, "pollinations", result.ok, result.ok ? undefined : result.error);
  return Response.json(result, { status: result.ok ? 200 : 400 });
}

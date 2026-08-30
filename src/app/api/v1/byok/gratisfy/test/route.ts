/**
 * POST /api/v1/byok/gratisfy/test — validate a Gratisfy key.
 * Body `{ key?: string }`. Requires a signed-in user. If `key` provided,
 * test THAT; else test the stored key for this user.
 */

import { loadBYOKKey, setBYOKValidation } from "@/lib/xyz";
import { validateGratisfyKey } from "@/lib/xyz/gratisfy";
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
    // empty body is fine — fall through to stored key
  }
  const bodyKey = (body.key ?? "").trim();
  const stored = (await loadBYOKKey(auth.userId, "gratisfy")) ?? "";
  const key = bodyKey || stored;
  if (!key) {
    return Response.json(
      { ok: false, error: "No key to test. Save a key first." },
      { status: 400 },
    );
  }
  const result = await validateGratisfyKey(key);
  await setBYOKValidation(auth.userId, "gratisfy", result.ok, result.ok ? undefined : result.error);
  return Response.json(result, { status: result.ok ? 200 : 400 });
}

/**
 * POST /api/v1/byok/gratisfy/test — validate a Gratisfy key (PRD §63, §54).
 * Body `{ key?: string }`. If `key` provided, test THAT; else test the stored
 * key. Marks validation result on the stored credential.
 * AUTH REQUIRED.
 */

import { loadBYOKKey, setBYOKValidation, validateGratisfyKey } from "@/lib/xyz";
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
  await setBYOKValidation(auth.userId, "gratisfy", result.ok);
  return Response.json(result, { status: result.ok ? 200 : 400 });
}

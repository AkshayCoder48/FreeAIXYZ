/**
 * POST /api/v1/byok/g4f/test — validate a G4F key (PRD §63, §54).
 * Body `{ key?: string }`. AUTH REQUIRED.
 */

import { loadBYOKKey, setBYOKValidation, validateG4fKey } from "@/lib/xyz";
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
  const stored = (await loadBYOKKey(auth.userId, "g4f")) ?? "";
  const key = bodyKey || stored;
  if (!key) {
    return Response.json(
      { ok: false, error: "No key to test. Save a key first." },
      { status: 400 },
    );
  }
  const result = await validateG4fKey(key);
  await setBYOKValidation(auth.userId, "g4f", result.ok);
  return Response.json(result, { status: result.ok ? 200 : 400 });
}

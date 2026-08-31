/**
 * POST /api/v1/byok/gratisfy/test — validate a Gratisfy key (PRIVACY-MODE).
 * Body `{ key: string }`. Requires a signed-in user. The client MUST
 * supply the key in the body — the server never persists it.
 */

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
    // empty body — fall through to "no key"
  }
  const key = (body.key ?? "").trim();
  if (!key) {
    return Response.json(
      { ok: false, error: "No key to test. Provide a key in the request body." },
      { status: 400 },
    );
  }
  const result = await validateGratisfyKey(key);
  return Response.json(result, { status: result.ok ? 200 : 400 });
}

/**
 * POST   /api/v1/byok/g4f — save (masked) BYOK key (PRD §5, §54).
 * DELETE /api/v1/byok/g4f — remove the key.
 * AUTH REQUIRED.
 */

import { saveBYOK, removeBYOK } from "@/lib/xyz";
import { requireAuth } from "@/lib/xyz/route-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if ("response" in auth) return auth.response;
  try {
    const body = (await request.json()) as { key?: string };
    const key = (body.key ?? "").trim();
    if (!key) {
      return Response.json(
        { error: { type: "invalid_request_error", code: "EMPTY_KEY", message: "API key is required." } },
        { status: 400 },
      );
    }
    const meta = await saveBYOK(auth.userId, "g4f", key);
    return Response.json({ ok: true, meta });
  } catch {
    return Response.json(
      { error: { type: "invalid_request_error", code: "BAD_BODY", message: "Invalid JSON body." } },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  const auth = await requireAuth(request);
  if ("response" in auth) return auth.response;
  await removeBYOK(auth.userId, "g4f");
  return Response.json({ ok: true });
}

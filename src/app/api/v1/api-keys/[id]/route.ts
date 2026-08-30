/**
 * DELETE /api/v1/api-keys/{id} — revoke an API key (soft-delete).
 */

import { NextRequest } from "next/server";
import { revokeApiKey } from "@/lib/xyz/api-keys";
import { requireAuth } from "@/lib/xyz/route-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(request);
  if ("response" in auth) return auth.response;
  const { id } = await params;
  if (!id) {
    return Response.json(
      { error: { type: "invalid_request", message: "Missing key id." } },
      { status: 400 },
    );
  }
  const ok = await revokeApiKey(auth.userId, id);
  if (!ok) {
    return Response.json(
      { error: { type: "not_found", message: "Key not found or already revoked." } },
      { status: 404 },
    );
  }
  return Response.json({ ok: true });
}

/**
 * POST   /api/v1/byok/g4f — save (masked) BYOK key, validate.
 * DELETE /api/v1/byok/g4f — remove the key.
 *
 * Requires a signed-in user (session cookie). Stored in OnyxBase keyed by
 * userId — persists across refresh / tab changes / devices. Never returns
 * the raw key.
 */

import { saveBYOK, removeBYOK, setBYOKValidation } from "@/lib/xyz";
import { validateG4fKey } from "@/lib/xyz/g4f";
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

    // Save first (encrypted) — we'll update validation state next.
    const meta = await saveBYOK(auth.userId, "g4f", key);

    // Validate against the upstream — no fake "Connected".
    const validation = await validateG4fKey(key);
    await setBYOKValidation(
      auth.userId,
      "g4f",
      validation.ok,
      validation.ok ? undefined : validation.error,
    );

    if (!validation.ok) {
      return Response.json(
        {
          ok: false,
          error: validation.error ?? "Validation failed",
          meta,
        },
        { status: 400 },
      );
    }

    return Response.json({
      ok: true,
      meta,
      validation: { ok: true, modelCount: validation.modelCount ?? 0 },
      modelsDiscovered: validation.modelCount ?? 0,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid request.";
    return Response.json(
      { error: { type: "invalid_request_error", code: "BAD_REQUEST", message } },
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

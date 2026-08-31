/**
 * POST   /api/v1/byok/gratisfy — validate a Gratisfy key (PRIVACY-MODE).
 * DELETE /api/v1/byok/gratisfy — no-op (the key lives in the user's
 *                                localStorage; the client deletes it
 *                                locally — no server-side state to clear).
 *
 * PRIVACY-MODE BYOK (2026-08-30): the user's private BYOK credentials
 * (Gratisfy gxyz-… keys) are NEVER persisted server-side. The POST
 * handler validates the key against the upstream and returns the masked
 * metadata + validation result so the client can store the key in
 * localStorage and surface the connected state in the UI.
 *
 * Requires a signed-in user — even though we don't store the key, the
 * validation round-trip is rate-limited per-user (the upstream has its
 * own rate limit too).
 */

import { validateGratisfyKey } from "@/lib/xyz/gratisfy";
import { maskKey } from "@/lib/xyz/crypto";
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

    // PRIVACY-MODE: validate only — NEVER save to OnyxBase.
    const validation = await validateGratisfyKey(key);
    const masked = maskKey(key);
    const addedAt = new Date().toISOString();

    if (!validation.ok) {
      return Response.json(
        {
          ok: false,
          error: validation.error ?? "Validation failed",
          meta: {
            provider: "gratisfy",
            connected: false,
            masked,
            addedAt,
            lastValidatedAt: addedAt,
            lastValidationOk: false,
          },
        },
        { status: 400 },
      );
    }

    return Response.json({
      ok: true,
      meta: {
        provider: "gratisfy",
        connected: true,
        masked,
        addedAt,
        lastValidatedAt: addedAt,
        lastValidationOk: true,
      },
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

/** DELETE — no-op in privacy-mode. The client deletes the key from
 *  localStorage; there's nothing server-side to clear. Returns ok:true
 *  so the existing UI's remove flow works without changes. */
export async function DELETE(request: Request) {
  const auth = await requireAuth(request);
  if ("response" in auth) return auth.response;
  return Response.json({ ok: true });
}

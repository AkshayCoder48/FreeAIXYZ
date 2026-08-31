/**
 * POST   /api/v1/byok/pollinations — validate a Pollinations token (PRIVACY-MODE).
 * DELETE /api/v1/byok/pollinations — no-op (token lives in localStorage).
 *
 * PRIVACY-MODE BYOK (2026-08-30): the user's private Pollinations token is
 * NEVER persisted server-side. The POST handler validates the token against
 * the upstream and returns the masked metadata + validation result so the
 * client can store the token in localStorage and surface the connected
 * state in the UI.
 *
 * For the OAuth "Connect wallet" flow, see ./connect/route.ts (it stashes
 * the token in a 60s-TTL KV entry, the browser redeems via ./redeem/).
 */

import { validatePollinationsKey } from "@/lib/xyz/pollinations";
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
        { error: { type: "invalid_request_error", code: "EMPTY_KEY", message: "Pollinations token is required." } },
        { status: 400 },
      );
    }

    // PRIVACY-MODE: validate only — NEVER save to OnyxBase.
    const validation = await validatePollinationsKey(key);
    const masked = maskKey(key);
    const addedAt = new Date().toISOString();

    if (!validation.ok) {
      return Response.json(
        {
          ok: false,
          error: validation.error ?? "Validation failed",
          meta: {
            provider: "pollinations",
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
        provider: "pollinations",
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

/** DELETE — no-op in privacy-mode. The client deletes the token from
 *  localStorage; there's nothing server-side to clear. */
export async function DELETE(request: Request) {
  const auth = await requireAuth(request);
  if ("response" in auth) return auth.response;
  return Response.json({ ok: true });
}

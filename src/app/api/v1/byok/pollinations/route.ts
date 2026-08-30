/**
 * POST   /api/v1/byok/pollinations — save (masked) Pollinations token, validate.
 * DELETE /api/v1/byok/pollinations — remove the token.
 *
 * Requires a signed-in user. Stored in OnyxBase keyed by userId — persists
 * across refresh / tab changes / devices. Never returns the raw token.
 *
 * For the OAuth "Connect" flow (Pollinations BYOP with commission), the
 * callback URI registered in the Pollinations dashboard for app key
 * pk_EGCSwhDRDNf7HtvK is:
 *   https://freeaixyz4all.vercel.app/api/v1/byok/pollinations/connect
 * That path is implemented at ./connect/route.ts (GET handler) — it
 * exchanges the OAuth code (+ PKCE verifier from a cookie) for a Bearer
 * token via exchangePollinationsCodeForToken, then saveBYOK + validate.
 * Manual key entry via the POST handler below is the fallback when the
 * OAuth round-trip isn't available.
 */

import { saveBYOK, removeBYOK, setBYOKValidation } from "@/lib/xyz";
import { validatePollinationsKey } from "@/lib/xyz/pollinations";
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

    // Save first (encrypted) — we'll update validation state next.
    const meta = await saveBYOK(auth.userId, "pollinations", key);

    // Validate against the upstream — no fake "Connected".
    const validation = await validatePollinationsKey(key);
    await setBYOKValidation(
      auth.userId,
      "pollinations",
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
  await removeBYOK(auth.userId, "pollinations");
  return Response.json({ ok: true });
}

/**
 * GET /api/v1/byok/pollinations/redeem?k=<opaque> — one-time token
 * redemption for the OAuth "Connect wallet" flow (PRIVACY-MODE BYOK).
 *
 * The /connect callback stashed the OAuth'd Pollinations token in OnyxBase
 * under `fxz:byok:redeem:<opaque>` with a short TTL. The browser hits this
 * endpoint ONCE to retrieve the token + write it to localStorage; this
 * endpoint deletes the KV entry in the same request so the token cannot be
 * redeemed twice or skimmed by a later visitor.
 *
 * Requires a signed-in user — the redemption entry is scoped to the
 * authenticated userId from the session cookie. A different signed-in
 * user cannot redeem someone else's token (the userId in the stashed
 * record must match).
 *
 * Returns: { ok: true, token, masked } on success
 *          404 on missing/expired/already-redeemed key
 *          403 on user mismatch
 *          401 when unauthenticated
 */

import { onyxGet, onyxDelete } from "@/lib/xyz/onyxbase";
import { maskKey } from "@/lib/xyz/crypto";
import { requireAuth } from "@/lib/xyz/route-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RedeemRecord {
  token: string;
  userId: string;
  createdAt: string;
}

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if ("response" in auth) return auth.response;

  const url = new URL(request.url);
  const k = url.searchParams.get("k")?.trim();
  if (!k || !/^[a-f0-9]{64}$/.test(k)) {
    return Response.json(
      { ok: false, error: "Invalid redemption key." },
      { status: 400 },
    );
  }

  const record = await onyxGet<RedeemRecord>(`fxz:byok:redeem:${k}`);
  if (!record || !record.token || !record.userId) {
    return Response.json(
      {
        ok: false,
        error:
          "Redemption key not found or expired. Please retry the Connect flow.",
      },
      { status: 404 },
    );
  }

  if (record.userId !== auth.userId) {
    return Response.json(
      { ok: false, error: "Redemption key was issued to a different account." },
      { status: 403 },
    );
  }

  // Delete the KV entry in the same request — one-time redemption.
  await onyxDelete(`fxz:byok:redeem:${k}`);

  return Response.json({
    ok: true,
    token: record.token,
    masked: maskKey(record.token),
  });
}

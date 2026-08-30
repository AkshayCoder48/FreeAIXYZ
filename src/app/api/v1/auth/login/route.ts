/**
 * POST /api/v1/auth/login — direct email login (NO verification code).
 *
 * Backed by OnyxBase (no Prisma, no DB schema sync needed). The user
 * submits an email; we immediately create or load the account, mint a
 * session token, store it in OnyxBase, and set the HttpOnly+Secure
 * `fxz_session` cookie (7-day TTL). The frontend collapses to a single
 * email field — no code step, no second request.
 *
 * Public. Rate-limited per email + per IP (60s window).
 */

import { signInWithEmail, buildSessionCookie } from "@/lib/xyz";
import { clientIp, isSecure } from "@/lib/xyz/route-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { email?: string };
    const email = (body.email ?? "").trim();
    if (!email) {
      return Response.json(
        { ok: false, message: "Email is required." },
        { status: 400 },
      );
    }
    const result = await signInWithEmail(email, clientIp(request));
    if (result.ok && result.sessionToken) {
      const cookie = buildSessionCookie(result.sessionToken, isSecure(request));
      return new Response(
        JSON.stringify({
          ok: true,
          userId: result.userId,
          message: result.message ?? "Signed in.",
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Set-Cookie": cookie,
          },
        },
      );
    }
    return Response.json(result, { status: 400 });
  } catch (err) {
    console.error("[auth/login] error:", err);
    return Response.json(
      { ok: false, message: "Could not sign in. Please try again." },
      { status: 500 },
    );
  }
}

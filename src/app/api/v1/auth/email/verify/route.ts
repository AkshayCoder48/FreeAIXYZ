/**
 * POST /api/v1/auth/email/verify — verify code + create session (PRD §81, §88).
 * PUBLIC. On success sets the HttpOnly+Secure+SameSite=Lax `fxz_session`
 * cookie (7-day TTL).
 */

import {
  verifyCodeAndCreateSession,
  buildSessionCookie,
} from "@/lib/xyz";
import { isSecure } from "@/lib/xyz/route-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { email?: string; code?: string };
    const email = (body.email ?? "").trim();
    const code = (body.code ?? "").trim();
    if (!email || !code) {
      return Response.json(
        { ok: false, message: "Email and code are required." },
        { status: 400 },
      );
    }
    const result = await verifyCodeAndCreateSession(email, code);
    if (result.ok && result.sessionToken) {
      const cookie = buildSessionCookie(result.sessionToken, isSecure(request));
      return new Response(
        JSON.stringify({ ok: true, userId: result.userId, message: result.message }),
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
  } catch {
    return Response.json(
      { ok: false, message: "Invalid request." },
      { status: 400 },
    );
  }
}

/**
 * POST /api/v1/auth/email/send — send a verification code (PRD §80, §82, §99).
 * PUBLIC. Generic response to prevent account enumeration (PRD §99).
 * In dev (EMAIL_PROVIDER unset) the code is returned as `devCode` so the
 * flow is testable without email infra.
 */

import { sendVerificationCode } from "@/lib/xyz";
import { clientIp } from "@/lib/xyz/route-auth";

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
    const result = await sendVerificationCode(email, clientIp(request));
    return Response.json(result, { status: result.ok ? 200 : 400 });
  } catch (err) {
    // Log the actual error for diagnostics; return a generic message to the
    // client (no internal details leaked).
    console.error("[auth/email/send] error:", err);
    return Response.json(
      { ok: false, message: "Could not send verification code. Please try again." },
      { status: 500 },
    );
  }
}

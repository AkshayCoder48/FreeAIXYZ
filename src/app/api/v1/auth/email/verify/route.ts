/**
 * POST /api/v1/auth/email/verify — DEPRECATED.
 *
 * OTP verification has been removed in favour of direct email login
 * (POST /api/v1/auth/login). This endpoint now returns 410 Gone.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return Response.json(
    {
      ok: false,
      message:
        "Email code verification has been removed. Use POST /api/v1/auth/login for direct email login.",
    },
    { status: 410 },
  );
}

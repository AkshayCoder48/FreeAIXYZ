/**
 * Shared route auth helper (PRD §88, §89, §91).
 * Server-side. Reads the session cookie via the auth module.
 */

import { getSessionUserId } from "./auth";

export async function requireAuth(
  request: Request,
): Promise<{ userId: string } | { response: Response }> {
  const userId = await getSessionUserId(request);
  if (!userId) {
    return {
      response: Response.json(
        {
          error: {
            type: "authentication_error",
            code: "UNAUTHENTICATED",
            message: "Sign in required.",
          },
        },
        { status: 401 },
      ),
    };
  }
  return { userId };
}

export function isSecure(request: Request): boolean {
  const url = new URL(request.url);
  return (
    url.protocol === "https:" ||
    request.headers.get("x-forwarded-proto") === "https"
  );
}

export function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

/**
 * Shared route auth helper (PRD §13, §14, §88, §89, §91).
 * Server-side. Supports dual authentication:
 *   1. Session cookie (web app users)
 *   2. `Authorization: Bearer fx_live_*` API key (programmatic clients)
 *
 * The two credential layers are kept separate (PRD §14):
 *   Layer 1 — FreeAIXYZ authenticates the application user (this file).
 *   Layer 2 — Provider BYOK authenticates FreeAIXYZ against the upstream
 *             provider using the user's stored credential (see byok.ts).
 *
 * ANONYMOUS BROWSER MODE (added this iteration):
 *   BYOK endpoints no longer require a signed-in user. Instead, the
 *   browser generates a random UUID stored in localStorage and sends it
 *   as the `X-Browser-Id` header. BYOK credentials are stored in OnyxBase
 *   keyed by this browser ID — no user accounts needed.
 */

import { getSessionUserId } from "./auth";
import { getApiKeyUserId } from "./api-keys";

export interface AuthContext {
  userId: string;
  /** "session" = web cookie, "apikey" = fx_live_* bearer token */
  authMethod: "session" | "apikey";
  scopes: string[] | null; // null for session auth (no scope restriction)
}

export async function requireAuth(
  request: Request,
): Promise<{ userId: string; authMethod: "session" | "apikey"; scopes: string[] | null } | { response: Response }> {
  // Layer 1.2 — try API key first (cheaper; no DB session lookup).
  const authHeader = request.headers.get("authorization");
  const xApiKey = request.headers.get("x-api-key");
  if (authHeader || xApiKey) {
    const ctx = await getApiKeyUserId(authHeader, xApiKey);
    if (ctx) {
      return {
        userId: ctx.userId,
        authMethod: "apikey",
        scopes: ctx.scopes,
      };
    }
    // If a key was supplied but invalid, return 401 immediately — don't
    // fall back to session cookie (avoid confusing error messages).
    return {
      response: Response.json(
        {
          error: {
            type: "authentication_error",
            code: "INVALID_API_KEY",
            message: "The supplied API key is invalid, revoked, or expired.",
          },
        },
        { status: 401 },
      ),
    };
  }

  // Layer 1.1 — session cookie (web users).
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
  return { userId, authMethod: "session", scopes: null };
}

/** Same as requireAuth but additionally enforces an API scope. */
export async function requireAuthScoped(
  request: Request,
  requiredScope: string,
): Promise<{ userId: string; authMethod: "session" | "apikey"; scopes: string[] | null } | { response: Response }> {
  const result = await requireAuth(request);
  if ("response" in result) return result;
  // Session auth bypasses scope checks (web users have full access).
  if (result.authMethod === "session") return result;
  // API key — check the scope.
  if (!result.scopes || !result.scopes.includes(requiredScope)) {
    return {
      response: Response.json(
        {
          error: {
            type: "authorization_error",
            code: "INSUFFICIENT_SCOPE",
            message: `This API key lacks the "${requiredScope}" scope.`,
          },
        },
        { status: 403 },
      ),
    };
  }
  return result;
}

// ─── Anonymous browser ID (BYOK without user accounts) ────────────────────────

/**
 * Resolve the anonymous browser ID from a request. The browser generates a
 * random UUID stored in localStorage and sends it as the `X-Browser-Id`
 * header. We fall back to a session cookie value or "anonymous" if absent.
 *
 * No auth required — this is purely for keying BYOK credentials in OnyxBase.
 */
export function getBrowserId(request: Request): string {
  const header = request.headers.get("x-browser-id")?.trim();
  if (header && header.length >= 8 && header.length <= 128) {
    return header;
  }
  // Fall back to session cookie value (if signed in) — keeps existing keys.
  const raw = request.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === "fxz_session" && v.length) return `sess:${v.join("=")}`;
  }
  return "anonymous";
}

/** Returns true if the browser ID is a real per-browser identifier. */
export function isAnonymousBrowserId(browserId: string): boolean {
  return browserId !== "anonymous";
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

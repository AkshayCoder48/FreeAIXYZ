/**
 * GET  /api/v1/byok/pollinations/callback — OAuth2 callback for the
 * "Connect your Pollinations Wallet" button.
 *
 * Flow (PKCE / S256, mandatory since 2026-08-30 — the Pollinations
 * authorize server returns "PKCE code_challenge is required for the
 * authorization code flow" without it):
 *   1. User clicks "Connect wallet" on the Pollinations BYOK card.
 *      The client click-handler calls generatePollinationsPkcePair(),
 *      stores code_verifier + state in two SameSite=Lax cookies
 *      (pollinations_pkce_verifier, pollinations_oauth_state), and
 *      navigates to enter.pollinations.ai/authorize?...&code_challenge=
 *      <base64url(SHA256(verifier))>&code_challenge_method=S256&state=...
 *   2. Pollinations redirects back to this endpoint with ?code=…&state=…
 *      (the cookies ride along because the redirect is a top-level
 *      navigation to our same origin → SameSite=Lax cookies are sent).
 *   3. We re-check state (CSRF) and exchange the code + code_verifier
 *      for a Bearer token via exchangePollinationsCodeForToken
 *      (POST enter.pollinations.ai/api/token — authorization_code grant).
 *   4. We persist the token to OnyxBase under the user's account by
 *      re-using the same saveBYOK + setBYOKValidation flow the manual
 *      POST /api/v1/byok/pollinations route uses, after a final
 *      validatePollinationsKey round-trip so the masked state stays
 *      consistent.
 *   5. We clear the PKCE + state cookies (Max-Age=0) and redirect back
 *      to /providers with ?connect=ok so the BYOK card surfaces a
 *      "Connected" message. On failure we redirect with
 *      ?connect=error&reason=… so the card surfaces the error inline
 *      (PRD §82 — never fake "Connected").
 *
 * Requires a signed-in user — the OAuth flow is per-account, and the
 * OnyxBase key is scoped to the userId. If the user is not signed in
 * (cookie missing or session expired), we redirect to /providers with
 * an error so they can sign in first.
 */

import { saveBYOK, setBYOKValidation } from "@/lib/xyz";
import {
  exchangePollinationsCodeForToken,
  getPollinationsAppKey,
  validatePollinationsKey,
} from "@/lib/xyz/pollinations";
import { requireAuth } from "@/lib/xyz/route-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROVIDERS_PAGE = "/providers";

const PKCE_VERIFIER_COOKIE = "pollinations_pkce_verifier";
const OAUTH_STATE_COOKIE = "pollinations_oauth_state";

/**
 * Build a 303-redirect Response that may ALSO carry Set-Cookie headers
 * (to clear the PKCE + state cookies). We can't use Response.redirect()
 * here because its Headers object is immutable, so .append("Set-Cookie", …)
 * throws "TypeError: immutable" at runtime on Vercel. Instead we construct
 * the Response manually with an array of [name, value] header pairs — the
 * array form of HeadersInit creates multiple same-named headers (needed
 * for multiple Set-Cookie values on a single response).
 */
function buildRedirect(
  target: URL,
  clearPkceCookies: boolean,
): Response {
  const headers: [string, string][] = [["Location", target.toString()]];
  if (clearPkceCookies) {
    headers.push(["Set-Cookie", `${PKCE_VERIFIER_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`]);
    headers.push(["Set-Cookie", `${OAUTH_STATE_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`]);
  }
  return new Response(null, { status: 303, headers });
}

function redirectWithError(
  reason: string,
  fallbackOrigin = "http://localhost:3000",
  clearCookies = false,
): Response {
  const target = new URL(PROVIDERS_PAGE, fallbackOrigin);
  target.searchParams.set("connect", "error");
  target.searchParams.set("provider", "pollinations");
  target.searchParams.set("reason", reason);
  return buildRedirect(target, clearCookies);
}

function redirectWithSuccess(fallbackOrigin = "http://localhost:3000"): Response {
  const target = new URL(PROVIDERS_PAGE, fallbackOrigin);
  target.searchParams.set("connect", "ok");
  target.searchParams.set("provider", "pollinations");
  // Always clear PKCE cookies on success — they're single-use.
  return buildRedirect(target, true);
}

/** Read a single cookie value out of the request's Cookie header. */
function readCookie(request: Request, name: string): string | null {
  const raw = request.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name && v.length) return decodeURIComponent(v.join("="));
  }
  return null;
}

export async function GET(request: Request): Promise<Response> {
  // Resolve absolute origin from the request so the redirect_uri we
  // pass to the token exchange matches what we used in the authorize URL.
  const url = new URL(request.url);
  const forwardedProto =
    request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
  const forwardedHost =
    request.headers.get("x-forwarded-host") || request.headers.get("host") || url.host;
  const origin = `${forwardedProto}://${forwardedHost}`;
  const fallbackOrigin = `${url.protocol.replace(":", "")}://${url.host}`;

  // Auth check — OAuth flow requires a session (token is stored per-user).
  const auth = await requireAuth(request);
  if ("response" in auth) {
    // Not signed in — surface a clear reason rather than the raw 401 JSON.
    return redirectWithError(
      "Sign in required before connecting Pollinations.",
      fallbackOrigin,
      true,
    );
  }

  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  const oauthErrorDescription = url.searchParams.get("error_description");

  if (oauthError) {
    return redirectWithError(
      `Pollinations denied the connection: ${oauthErrorDescription || oauthError}`,
      fallbackOrigin,
      true,
    );
  }
  if (!code) {
    return redirectWithError(
      "Missing authorization code from Pollinations.",
      fallbackOrigin,
      true,
    );
  }

  // PKCE verifier — must be present (we always send code_challenge in the
  // authorize URL now). Its absence means the cookies expired (Max-Age=600)
  // or the user wiped cookies mid-flow.
  const codeVerifier = readCookie(request, PKCE_VERIFIER_COOKIE);
  if (!codeVerifier) {
    return redirectWithError(
      "PKCE verifier missing — the connect session expired. Please retry.",
      fallbackOrigin,
      true,
    );
  }

  // CSRF state check — compare the state Pollinations echoes back to the
  // one we stored in a cookie before redirecting away. Prevents login CSRF.
  const expectedState = readCookie(request, OAUTH_STATE_COOKIE);
  if (!expectedState || returnedState !== expectedState) {
    return redirectWithError(
      "OAuth state mismatch — please retry the connect flow.",
      fallbackOrigin,
      true,
    );
  }

  // App key must be configured (defensive — the client also checks this
  // before showing the button, but a misconfigured env on the server side
  // would still break the token exchange).
  if (!getPollinationsAppKey()) {
    return redirectWithError(
      "POLLINATIONS_APP_KEY is not configured.",
      fallbackOrigin,
      true,
    );
  }

  const redirectUri = `${origin.replace(/\/$/, "")}/api/v1/byok/pollinations/callback`;

  // Exchange the code + verifier for a Bearer token.
  let token: string;
  try {
    token = await exchangePollinationsCodeForToken({ code, redirectUri, codeVerifier });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return redirectWithError(
      `Could not exchange Pollinations code for a token. ${msg} — paste the token manually instead.`,
      fallbackOrigin,
      true,
    );
  }

  // Persist + validate, mirroring the manual POST /api/v1/byok/pollinations route.
  try {
    await saveBYOK(auth.userId, "pollinations", token);
    const validation = await validatePollinationsKey(token);
    await setBYOKValidation(
      auth.userId,
      "pollinations",
      validation.ok,
      validation.ok ? undefined : validation.error,
    );
    if (!validation.ok) {
      // The token came back from OAuth but failed our userinfo check — surface
      // it as a soft error so the user can still see the masked key + try Remove.
      return redirectWithError(
        `Pollinations token saved but failed validation: ${validation.error ?? "unknown"}`,
        fallbackOrigin,
        true,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return redirectWithError(
      `Failed to save Pollinations token: ${msg}`,
      fallbackOrigin,
      true,
    );
  }

  return redirectWithSuccess(fallbackOrigin);
}

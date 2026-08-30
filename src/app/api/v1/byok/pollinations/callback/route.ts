/**
 * GET  /api/v1/byok/pollinations/callback — OAuth2 callback for the
 * "Connect your Pollinations Wallet" button.
 *
 * Flow:
 *   1. User clicks "Connect wallet" on the Pollinations BYOK card.
 *      The button is built by `buildPollinationsAuthorizeUrl({origin})`
 *      and opens https://enter.pollinations.ai/authorize?client_id=<app key>
 *      &response_type=code&redirect_uri=<this URL>&state=<opaque>.
 *   2. Pollinations redirects back to this endpoint with ?code=…&state=…
 *   3. We exchange the code for a Bearer token via
 *      `exchangePollinationsCodeForToken` (POST /api/token — OAuth2
 *      authorization_code grant).
 *   4. We persist the token to OnyxBase under the user's account by
 *      re-using the same `saveBYOK + setBYOKValidation` flow the manual
 *      POST /api/v1/byok/pollinations route uses, after a final
 *      `validatePollinationsKey` round-trip so the masked state stays
 *      consistent.
 *   5. We redirect back to /providers with a toast-style `?connect=ok`
 *      query so the BYOK card can surface a "Connected" message. On
 *      failure we redirect with `?connect=error&reason=…` so the card
 *      can surface the error inline (PRD §82 — never fake "Connected").
 *
 * Requires a signed-in user — the OAuth flow is per-account, and the
 * OnyxBase key is scoped to the userId. If the user is not signed in
 * (cookie missing or session expired), we redirect to /providers with
 * an error so they can sign in first.
 */

import { saveBYOK, setBYOKValidation } from "@/lib/xyz";
import {
  buildPollinationsAuthorizeUrl,
  exchangePollinationsCodeForToken,
  validatePollinationsKey,
} from "@/lib/xyz/pollinations";
import { requireAuth } from "@/lib/xyz/route-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROVIDERS_PAGE = "/providers";

function redirectWithError(reason: string, fallbackOrigin = "http://localhost:3000"): Response {
  const target = new URL(PROVIDERS_PAGE, fallbackOrigin);
  target.searchParams.set("connect", "error");
  target.searchParams.set("provider", "pollinations");
  target.searchParams.set("reason", reason);
  return Response.redirect(target, 303);
}

function redirectWithSuccess(fallbackOrigin = "http://localhost:3000"): Response {
  const target = new URL(PROVIDERS_PAGE, fallbackOrigin);
  target.searchParams.set("connect", "ok");
  target.searchParams.set("provider", "pollinations");
  return Response.redirect(target, 303);
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
    );
  }
  if (!code) {
    return redirectWithError(
      "Missing authorization code from Pollinations.",
      fallbackOrigin,
    );
  }
  void returnedState; // CSRF check placeholder — TODO: round-trip state in a signed cookie.

  // Build the redirect_uri that MUST match what we used in the authorize URL.
  const authorize = buildPollinationsAuthorizeUrl({ origin });
  if (!authorize) {
    return redirectWithError(
      "POLLINATIONS_APP_KEY is not configured.",
      fallbackOrigin,
    );
  }
  const redirectUri = `${origin.replace(/\/$/, "")}/api/v1/byok/pollinations/callback`;

  // Exchange the code for a Bearer token.
  let token: string;
  try {
    token = await exchangePollinationsCodeForToken({ code, redirectUri });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return redirectWithError(
      `Could not exchange Pollinations code for a token. ${msg} — paste the token manually instead.`,
      fallbackOrigin,
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
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return redirectWithError(
      `Failed to save Pollinations token: ${msg}`,
      fallbackOrigin,
    );
  }

  return redirectWithSuccess(fallbackOrigin);
}

/**
 * GET  /api/v1/byok/pollinations/connect — OAuth2 callback for the
 * "Connect your Pollinations Wallet" button.
 *
 * PATH NOTE (2026-08-30): Pollinations' app dashboard has THIS exact URI
 * registered as the only allowed redirect_uri for app key
 * pk_EGCSwhDRDNf7HtvK:
 *   https://freeaixyz4all.vercel.app/api/v1/byok/pollinations/connect
 * (Confirmed via GET https://enter.pollinations.ai/api/app-lookup?client_id=
 *  pk_EGCSwhDRDNf7HtvK — redirectUris[0] is ".../connect", not ".../callback".
 *  The previous /callback path returned redirect_uri_mismatch → "This
 *  redirect URL is not registered for this app. Authorization blocked.")
 *
 * PRIVACY-MODE BYOK (2026-08-30): the OAuth'd Pollinations token is NEVER
 * persisted server-side. Instead, the callback stashes it in OnyxBase KV
 * under a single-use opaque redemption key (`fxz:byok:redeem:<32-hex>`)
 * with a 60-second TTL, then redirects to /providers with ?redeem=<opaque>.
 * The browser fetches GET /api/v1/byok/pollinations/redeem?k=<opaque>,
 * gets the token, deletes the KV entry, and stores the token in
 * localStorage. The server never holds the token past the 60s window.
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
 *   4. We stash the token in OnyxBase under fxz:byok:redeem:<opaque>
 *      with a 60s TTL. We do NOT call saveBYOK — the token never lands
 *      in the per-user persistent KV namespace.
 *   5. We clear the PKCE + state cookies (Max-Age=0) and redirect back
 *      to /providers with ?connect=ok&provider=pollinations&redeem=<opaque>.
 *   6. The browser's ByokProviders component reads the ?redeem= param,
 *      fetches GET /api/v1/byok/pollinations/redeem?k=<opaque> (which
 *      returns + deletes the stashed token), and writes the token to
 *      localStorage under the `fxz:byok:pollinations` key. The server's
 *      copy is destroyed in the same request.
 *
 * Requires a signed-in user — the OAuth flow is per-account, and the
 * redemption entry is scoped to the userId so a different user can't
 * redeem someone else's OAuth token. If the user is not signed in
 * (cookie missing or session expired), we redirect to /providers with
 * an error so they can sign in first.
 */

import { onyxSet, onyxGet, onyxDelete } from "@/lib/xyz/onyxbase";
import {
  exchangePollinationsCodeForToken,
  getPollinationsAppKey,
  validatePollinationsKey,
} from "@/lib/xyz/pollinations";
import { requireAuth } from "@/lib/xyz/route-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROVIDERS_PAGE = "/providers";
/** The path segment Pollinations has registered for this app key. Must
 *  match the redirectUris[0] returned by /api/app-lookup. DO NOT change
 *  to /callback — that path returns redirect_uri_mismatch. */
const CALLBACK_PATH = "/api/v1/byok/pollinations/connect";

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

function redirectWithSuccess(
  redeemKey: string,
  fallbackOrigin = "http://localhost:3000",
): Response {
  const target = new URL(PROVIDERS_PAGE, fallbackOrigin);
  target.searchParams.set("connect", "ok");
  target.searchParams.set("provider", "pollinations");
  target.searchParams.set("redeem", redeemKey);
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

  const redirectUri = `${origin.replace(/\/$/, "")}${CALLBACK_PATH}`;

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

  // Stash the token in OnyxBase KV under a single-use opaque redemption
  // key (60-second TTL). The browser redeems it via GET
  // /api/v1/byok/pollinations/redeem?k=<opaque> and stores the token in
  // localStorage. The server never persists the token past the 60s window.
  // PRIVACY-MODE: no saveBYOK call, no per-user persistent KV namespace.
  let redeemKey: string;
  try {
    redeemKey = generateRedeemKey();
    const stashed = await onyxSet(`fxz:byok:redeem:${redeemKey}`, {
      token,
      userId: auth.userId,
      createdAt: new Date().toISOString(),
    });
    if (!stashed.ok) {
      return redirectWithError(
        `Failed to stash Pollinations token for redemption. Paste the token manually instead.`,
        fallbackOrigin,
        true,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return redirectWithError(
      `Failed to stash Pollinations token: ${msg}`,
      fallbackOrigin,
      true,
    );
  }

  // Optional: best-effort validation round-trip — surface a soft warning
  // if the token fails our userinfo check, but still hand it to the
  // browser (the user can decide whether to keep it). We never persist
  // the validation result server-side.
  try {
    const validation = await validatePollinationsKey(token);
    if (!validation.ok) {
      // Still redeem — the user can remove the token from localStorage if
      // they don't want it. Add a reason so the UI surfaces a soft warning.
      const target = new URL(PROVIDERS_PAGE, fallbackOrigin);
      target.searchParams.set("connect", "ok");
      target.searchParams.set("provider", "pollinations");
      target.searchParams.set("redeem", redeemKey);
      target.searchParams.set("warning", `Token saved but failed validation: ${validation.error ?? "unknown"}`);
      return buildRedirect(target, true);
    }
  } catch {
    // Validation best-effort — don't fail the OAuth flow.
  }

  return redirectWithSuccess(redeemKey, fallbackOrigin);
}

/** Generate a 32-byte hex opaque redemption key. Used once, then deleted
 *  from OnyxBase by the /redeem endpoint. */
function generateRedeemKey(): string {
  const bytes = new Uint8Array(32);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

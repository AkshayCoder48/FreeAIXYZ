/**
 * Pollinations BYOK adapter.
 *
 * The user supplies a Pollinations app token (Bearer). We validate it
 * against the Pollinations userinfo endpoint and (optionally) discover
 * the model list for the catalog.
 *
 * Endpoints:
 *   Models:  GET  https://text.pollinations.ai/models
 *            (accepts Authorization: Bearer <token>; no-auth also works for
 *             the public list, but sending the token validates it)
 *   Chat:    POST https://text.pollinations.ai/v1/chat/completions
 *            (OpenAI-shaped; the native provider adapter in
 *             src/lib/providers/pollinations.ts handles streaming)
 *   Userinfo:GET  https://enter.pollinations.ai/api/device/userinfo
 *            (AUTH-GATED — 401 for missing/invalid tokens; this is the only
 *             endpoint that actually distinguishes valid from invalid keys,
 *             because /models is public and 200s even without auth)
 *   OAuth:   GET  https://enter.pollinations.ai/authorize?client_id=<app key>
 *            (publishable app key from the Pollinations dashboard — exposed
 *             to the browser via NEXT_PUBLIC_POLLINATIONS_APP_KEY; the
 *             "Connect your Pollinations Wallet" button on the BYOK card
 *             opens this URL with response_type=code and our callback as
 *             redirect_uri; the callback at /api/v1/byok/pollinations/callback
 *             captures the code, swaps it for a token via /api/token, and
 *             saves the token to OnyxBase under the user's account.)
 *
 *   Token:   POST https://enter.pollinations.ai/api/token  (OAuth2 code exchange)
 *
 * Two ways to obtain a Pollinations token:
 *   1. Paste a manually-obtained token into the BYOK card input.
 *   2. Click "Connect your Pollinations Wallet" → OAuth code flow →
 *      callback handler swaps the code for a token automatically.
 */

export interface DiscoveredPollinationsModel {
  upstreamId: string;
  name: string;
  description?: string;
  capabilities: string[];
  contextLength?: number;
  modality?: string;
  rawMetadata?: Record<string, unknown>;
}

export interface PollinationsValidationResult {
  ok: boolean;
  error?: string;
  modelCount?: number;
}

const MODELS_URL = "https://text.pollinations.ai/models";
const USERINFO_URL = "https://enter.pollinations.ai/api/device/userinfo";
const AUTHORIZE_URL = "https://enter.pollinations.ai/authorize";
const TOKEN_URL = "https://enter.pollinations.ai/api/token";
const TIMEOUT_MS = 12_000;

/**
 * The publishable Pollinations app key (pk_-prefixed). Safe to expose in
 * the browser — it can only initiate the OAuth flow, never withdraw
 * funds or read another user's balance. Read from NEXT_PUBLIC_POLLINATIONS_APP_KEY
 * so both server + client can resolve it.
 */
export function getPollinationsAppKey(): string {
  return (
    process.env.NEXT_PUBLIC_POLLINATIONS_APP_KEY ||
    process.env.POLLINATIONS_APP_KEY ||
    ""
  );
}

/**
 * Build the OAuth authorize URL for the "Connect your Pollinations Wallet"
 * button. The user is sent to enter.pollinations.ai/authorize with our app
 * key as client_id and our /api/v1/byok/pollinations/callback as the
 * redirect_uri. The state is a random hex string that we re-check in the
 * callback (basic CSRF guard; PKCE would be even better but Pollinations'
 * PKCE support is undocumented).
 *
 * The function is callable from both server and client (it only reads the
 * publishable env var, never the secret). On the server, the absolute
 * origin is computed from the request Host header; on the client, we fall
 * back to window.location.origin.
 */
export function buildPollinationsAuthorizeUrl(opts: {
  /** Absolute origin for the callback redirect, e.g. https://freeaixyz4all.vercel.app */
  origin: string;
  /** Optional opaque state — defaults to a fresh 16-byte hex string. */
  state?: string;
}): { url: string; state: string } | null {
  const appKey = getPollinationsAppKey();
  if (!appKey) return null;
  const redirectUri = `${opts.origin.replace(/\/$/, "")}/api/v1/byok/pollinations/callback`;
  const state =
    opts.state ||
    (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)) +
      Date.now().toString(36);
  const params = new URLSearchParams({
    client_id: appKey,
    response_type: "code",
    redirect_uri: redirectUri,
    state,
    scope: "openid profile",
  });
  return { url: `${AUTHORIZE_URL}?${params.toString()}`, state };
}

/**
 * Exchange an OAuth authorization code for a Pollinations Bearer token.
 * POSTs to https://enter.pollinations.ai/api/token with the standard
 * OAuth2 `authorization_code` grant shape:
 *   { grant_type: "authorization_code", code, redirect_uri, client_id }
 *
 * Returns the token string on success, throws on failure. The caller
 * (the callback route handler) is responsible for persisting the token
 * to OnyxBase under the user's account.
 *
 * NOTE: Pollinations' token endpoint is undocumented in our codebase. We
 * follow the OAuth2 convention; if Pollinations' endpoint follows a
 * different shape, this function will throw and the user will see a
 * friendly "Connect manually instead" message in the callback UI.
 */
export async function exchangePollinationsCodeForToken(opts: {
  code: string;
  /** Must match the redirect_uri passed to buildPollinationsAuthorizeUrl. */
  redirectUri: string;
}): Promise<string> {
  const appKey = getPollinationsAppKey();
  if (!appKey) {
    throw new Error("POLLINATIONS_APP_KEY is not configured.");
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: opts.code,
      redirect_uri: opts.redirectUri,
      client_id: appKey,
    });
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Pollinations token exchange failed (HTTP ${res.status}): ${text.slice(0, 200)}`,
      );
    }
    const data = (await res.json().catch(() => null)) as
      | { access_token?: string; token?: string; id_token?: string; error?: string; error_description?: string }
      | null;
    const token = data?.access_token || data?.token || data?.id_token;
    if (!token) {
      const errDetail = data?.error_description || data?.error || "no access_token in response";
      throw new Error(`Pollinations token exchange returned no token: ${errDetail}`);
    }
    return token as string;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not exchange Pollinations code: ${msg}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Validate a Pollinations token.
 *
 * IMPORTANT: text.pollinations.ai/models is PUBLIC — it returns 200 with a
 * model list even when no Authorization header is supplied. So calling it
 * with a fake Bearer token also returns 200 and a naive validator would
 * accept any string as "valid". To actually distinguish valid from invalid
 * tokens we hit the authenticated userinfo endpoint instead — it returns
 * 401 for missing/invalid tokens and 200 with `{ sub, preferred_username,
 * picture, ... }` for valid ones.
 */
export async function validatePollinationsKey(
  key: string,
): Promise<PollinationsValidationResult> {
  const trimmed = key.trim();
  if (!trimmed) {
    return { ok: false, error: "No key provided." };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    // 1) Real validation: the userinfo endpoint requires a valid Bearer
    //    token and 401s otherwise. This is the only way to reject fake keys.
    const userRes = await fetch(USERINFO_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${trimmed}`, Accept: "application/json" },
      signal: ctrl.signal,
    });
    if (userRes.status === 401 || userRes.status === 403) {
      return { ok: false, error: "Pollinations rejected this token (unauthorized)." };
    }
    if (!userRes.ok) {
      return { ok: false, error: `Pollinations returned HTTP ${userRes.status}.` };
    }
    // 200 — token is valid. Count the models from the public list endpoint.
    let modelCount = 0;
    try {
      const modelsRes = await fetch(MODELS_URL, {
        method: "GET",
        headers: { Authorization: `Bearer ${trimmed}`, Accept: "application/json" },
        signal: ctrl.signal,
      });
      if (modelsRes.ok) {
        const data = await modelsRes.json().catch(() => null);
        if (Array.isArray(data)) {
          modelCount = data.length;
        } else if (data && typeof data === "object" && Array.isArray((data as { models?: unknown }).models)) {
          modelCount = ((data as { models: unknown[] }).models).length;
        }
      }
    } catch {
      // model count is best-effort; the key itself is valid.
    }
    return { ok: true, modelCount };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Network error";
    return { ok: false, error: `Could not reach Pollinations: ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}

/** Discover Pollinations models for the catalog (best-effort). */
export async function discoverPollinationsModels(
  key?: string,
): Promise<DiscoveredPollinationsModel[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (key) headers.Authorization = `Bearer ${key}`;
    const res = await fetch(MODELS_URL, {
      method: "GET",
      headers,
      signal: ctrl.signal,
    });
    if (!res.ok) return [];
    const data = await res.json().catch(() => null);
    const list: unknown[] = Array.isArray(data)
      ? data
      : data && typeof data === "object" && Array.isArray((data as { models?: unknown[] }).models)
        ? (data as { models: unknown[] }).models
        : [];
    return list.map((raw) => {
      const obj = (raw ?? {}) as Record<string, unknown>;
      const id = (obj.id as string) ?? (obj.name as string) ?? "pollinations-model";
      const name = (obj.name as string) ?? id;
      const desc = (obj.description as string) ?? undefined;
      const capsRaw = obj.capabilities;
      const caps = Array.isArray(capsRaw)
        ? capsRaw.map((c) => String(c))
        : ["text"];
      const ctx = typeof obj.context_length === "number" ? obj.context_length : undefined;
      const mod = typeof obj.modality === "string" ? obj.modality : "language";
      return {
        upstreamId: id,
        name,
        description: desc,
        capabilities: caps,
        contextLength: ctx,
        modality: mod,
        rawMetadata: obj,
      };
    });
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

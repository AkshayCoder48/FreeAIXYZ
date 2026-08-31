/**
 * OnyxBase KV client — durable Telegram-backed key-value store.
 *
 * Base URL:   process.env.ONYXBASE_URL  (default https://onyxbase.vercel.app)
 * API Key:    process.env.ONYXBASE_API_KEY  (kv_live_<28 hex>)
 * Auth:       Authorization: Bearer <key>
 *
 * Endpoints used (see OnyxBase REST API spec):
 *   POST   /v1/set                  body { key, value, collection? }
 *   GET    /v1/get/:key?collection=  returns { ok, value, type, updatedAt }
 *   DELETE /v1/delete/:key?collection=
 *   GET    /v1/list?collection=      returns { ok, keys, count }
 *   GET    /v1/whoami                returns { userId, apiKeyId, apiKeyName }
 *   GET    /v1/health                no-auth liveness probe
 *
 * Values are auto-typed by OnyxBase (string / number / boolean / JSON).
 * We pass JSON objects and they round-trip as JSON.
 *
 * FREEAIXYZ PERSISTENCE MODEL (this iteration):
 *   OnyxBase is the SINGLE source of truth for:
 *     - User accounts          key: fxz:user:{userId}
 *     - Email→userId index     key: fxz:userbyemail:{email}
 *     - Sessions               key: fxz:session:{tokenHash}
 *     - BYOK credentials       key: fxz:byok:{userId}:{provider}
 *   Prisma is no longer used for auth / sessions / byok. This means the
 *   whole auth + BYOK flow works on Vercel without a synced DB schema.
 *
 * SECURITY: this module is SERVER-ONLY. The API key is never sent to the
 * browser. Mark every route that uses this with `runtime = "nodejs"`.
 */

/** Resolve base URL without trailing slash. */
function baseUrl(): string {
  const url = process.env.ONYXBASE_URL || "https://onyxbase.vercel.app";
  return url.replace(/\/+$/, "");
}

/** Resolve the Bearer token; throws if unset in production. */
function apiKey(): string {
  const key = process.env.ONYXBASE_API_KEY;
  if (!key) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("ONYXBASE_API_KEY is not set (production).");
    }
    // Dev fallback — will get 401, but at least won't crash module load.
    return "kv_live_dev_unconfigured";
  }
  return key;
}

/** Default collection name for FreeAIXYZ KV. */
export const DEFAULT_COLLECTION = "freeaixyz";

export interface OnyxGetResult<T = unknown> {
  ok: boolean;
  key?: string;
  value?: T;
  type?: string;
  collection?: string;
  updatedAt?: string;
}

export interface OnyxSetResult {
  ok: boolean;
  key?: string;
  updatedAt?: string;
}

export interface OnyxWhoami {
  userId?: string;
  apiKeyId?: string;
  apiKeyName?: string;
  isAdmin?: boolean;
}

async function call(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const ctrl = new AbortController();
  const timeoutMs = init.timeoutMs ?? 12_000;
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl()}${path}`, {
      ...init,
      signal: init.signal ?? ctrl.signal,
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/** SET a value (upsert). Auto-typed — pass any JSON-serializable value.
 *
 * NOTE (2026-08-30): we pass `cache: "no-store"` on the underlying fetch
 * because Next.js dev mode (Turbopack) was observed silently caching POST
 * requests — `set` returned `{ ok: true }` but the key never persisted to
 * OnyxBase. Forcing no-store guarantees the actual network round-trip on
 * every call. This is a no-op on Vercel serverless (each cold instance
 * starts fresh).
 */
export async function onyxSet<T>(
  key: string,
  value: T,
  collection: string = DEFAULT_COLLECTION,
): Promise<OnyxSetResult> {
  try {
    const res = await call("/v1/set", {
      method: "POST",
      body: JSON.stringify({ key, value, collection }),
      // Force no-store — see NOTE above.
      // @ts-expect-error: 'cache' is valid on RequestInit but TS lib defs
      //   vary across Next.js versions.
      cache: "no-store",
    } as RequestInit);
    if (!res.ok) {
      return { ok: false };
    }
    const data = (await res.json()) as OnyxSetResult;
    return data;
  } catch {
    return { ok: false };
  }
}

/** GET a value. Returns null if not found or unreachable.
 *
 * NOTE (2026-08-30): we pass `cache: "no-store"` on the underlying fetch
 * because Next.js dev mode (Turbopack) was observed silently caching GET
 * responses — a freshly-set key wouldn't be visible to a subsequent GET
 * without no-store. Same caveat as onyxSet for Vercel serverless.
 */
export async function onyxGet<T = unknown>(
  key: string,
  collection: string = DEFAULT_COLLECTION,
): Promise<T | null> {
  try {
    const res = await call(
      `/v1/get/${encodeURIComponent(key)}?collection=${encodeURIComponent(collection)}`,
      {
        method: "GET",
        // @ts-expect-error: 'cache' is valid on RequestInit but TS lib defs
        //   vary across Next.js versions.
        cache: "no-store",
      } as RequestInit,
    );
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const data = (await res.json()) as OnyxGetResult<T>;
    return data.value ?? null;
  } catch {
    return null;
  }
}

/** DELETE a key. Idempotent — returns ok even if the key didn't exist. */
export async function onyxDelete(
  key: string,
  collection: string = DEFAULT_COLLECTION,
): Promise<boolean> {
  try {
    const res = await call(
      `/v1/delete/${encodeURIComponent(key)}?collection=${encodeURIComponent(collection)}`,
      {
        method: "DELETE",
        // @ts-expect-error: 'cache' is valid on RequestInit but TS lib defs
        //   vary across Next.js versions.
        cache: "no-store",
      } as RequestInit,
    );
    return res.ok;
  } catch {
    return false;
  }
}

/** LIST keys in a collection. */
export async function onyxList(
  collection: string = DEFAULT_COLLECTION,
): Promise<string[]> {
  try {
    const res = await call(
      `/v1/list?collection=${encodeURIComponent(collection)}`,
      { method: "GET" },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { ok: boolean; keys?: string[] };
    return data.keys ?? [];
  } catch {
    return [];
  }
}

/** WHOAMI — verify the API key + return account info. */
export async function onyxWhoami(): Promise<OnyxWhoami | null> {
  try {
    const res = await call("/v1/whoami", { method: "GET" });
    if (!res.ok) return null;
    return (await res.json()) as OnyxWhoami;
  } catch {
    return null;
  }
}

/** HEALTH — no-auth liveness probe. */
export async function onyxHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl()}/v1/health`, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── User + Session helpers (OnyxBase-backed auth) ──────────────────────────

/** User record shape stored under `fxz:user:{userId}`. */
export interface OnyxUserRecord {
  id: string;
  email: string;
  createdAt: string;
  lastLoginAt: string;
  status: "active" | "disabled";
  /**
   * Whether the user has verified control of their email. For the
   * direct-email-login flow (no OTP, no password) we treat the email as
   * implicitly verified at sign-in time, so this is always true. The
   * field exists so future verification flows can flip it false without
   * changing the record shape.
   */
  emailVerified?: boolean;
}

/** Session record shape stored under `fxz:session:{tokenHash}`. */
export interface OnyxSessionRecord {
  userId: string;
  email: string;
  createdAt: string;
  expiresAt: string;
}

const USER_PREFIX = "fxz:user:";
const USER_BY_EMAIL_PREFIX = "fxz:userbyemail:";
const SESSION_PREFIX = "fxz:session:";

/** Build the OnyxBase key for a user record. */
export function userKey(userId: string): string {
  return `${USER_PREFIX}${userId}`;
}

/** Build the OnyxBase key for the email→userId index. */
export function userByEmailKey(email: string): string {
  return `${USER_BY_EMAIL_PREFIX}${email}`;
}

/** Build the OnyxBase key for a session record. */
export function sessionKey(tokenHash: string): string {
  return `${SESSION_PREFIX}${tokenHash}`;
}

/** Save a user record (upsert). */
export async function saveUser(user: OnyxUserRecord): Promise<boolean> {
  const r1 = await onyxSet(userKey(user.id), user);
  // Also maintain the email→userId index so lookup-by-email is O(1).
  const r2 = await onyxSet(userByEmailKey(user.email), user.id);
  return r1.ok && r2.ok;
}

/** Load a user record by id. */
export async function loadUserById(userId: string): Promise<OnyxUserRecord | null> {
  return onyxGet<OnyxUserRecord>(userKey(userId));
}

/** Resolve a userId from an email (via the email→userId index). */
export async function loadUserIdByEmail(email: string): Promise<string | null> {
  return onyxGet<string>(userByEmailKey(email));
}

/** Delete a user record + its email index. */
export async function deleteUser(userId: string, email: string): Promise<void> {
  await onyxDelete(userKey(userId));
  await onyxDelete(userByEmailKey(email));
}

/**
 * Save a session record (upsert). Sessions are keyed by the SHA-256 hash of
 * the session token (never the raw token) — a user may have multiple
 * sessions across browsers/devices.
 */
export async function saveSession(
  tokenHash: string,
  session: OnyxSessionRecord,
): Promise<boolean> {
  const result = await onyxSet(sessionKey(tokenHash), session);
  return result.ok;
}

/** Load a session record by token hash. */
export async function loadSession(tokenHash: string): Promise<OnyxSessionRecord | null> {
  return onyxGet<OnyxSessionRecord>(sessionKey(tokenHash));
}

/** Delete a session by token hash (logout). */
export async function deleteSession(tokenHash: string): Promise<boolean> {
  return onyxDelete(sessionKey(tokenHash));
}

// ─── BYOK helpers (OnyxBase-backed, keyed by userId) ────────────────────────

/**
 * Convenience: store a BYOK credential for a user.
 * Key shape: `fxz:byok:{userId}:{provider}` → { encryptedKey, masked, addedAt }
 *
 * NOTE: the `id` parameter is the authenticated userId (from the session
 * cookie), NOT a browser-local UUID. This means saved keys persist across
 * refresh / tab changes / devices — they live with the account, server-side.
 */
export function byokKey(userId: string, provider: string): string {
  return `fxz:byok:${userId}:${provider}`;
}

/** Store a BYOK credential blob for a user. */
export async function saveByokToOnyx(
  userId: string,
  provider: string,
  blob: { encryptedKey: string; masked: string; addedAt: string; validatedAt?: string | null; validationError?: string | null },
): Promise<boolean> {
  const result = await onyxSet(byokKey(userId, provider), blob);
  return result.ok;
}

/** Load a BYOK credential blob for a user. */
export async function loadByokFromOnyx(
  userId: string,
  provider: string,
): Promise<{ encryptedKey: string; masked: string; addedAt: string; validatedAt?: string | null; validationError?: string | null } | null> {
  return onyxGet(byokKey(userId, provider));
}

/** Remove a BYOK credential for a user. */
export async function removeByokFromOnyx(
  userId: string,
  provider: string,
): Promise<boolean> {
  return onyxDelete(byokKey(userId, provider));
}

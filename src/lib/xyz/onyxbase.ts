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

/** Default collection name for FreeAIXYZ BYOK + misc KV. */
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

/** SET a value (upsert). Auto-typed — pass any JSON-serializable value. */
export async function onyxSet<T>(
  key: string,
  value: T,
  collection: string = DEFAULT_COLLECTION,
): Promise<OnyxSetResult> {
  try {
    const res = await call("/v1/set", {
      method: "POST",
      body: JSON.stringify({ key, value, collection }),
    });
    if (!res.ok) {
      return { ok: false };
    }
    const data = (await res.json()) as OnyxSetResult;
    return data;
  } catch {
    return { ok: false };
  }
}

/** GET a value. Returns null if not found or unreachable. */
export async function onyxGet<T = unknown>(
  key: string,
  collection: string = DEFAULT_COLLECTION,
): Promise<T | null> {
  try {
    const res = await call(
      `/v1/get/${encodeURIComponent(key)}?collection=${encodeURIComponent(collection)}`,
      { method: "GET" },
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
      { method: "DELETE" },
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

/**
 * Convenience: store a BYOK credential for a browser session.
 * Key shape: `byok:{browserId}:{provider}` → { encryptedKey, masked, addedAt }
 */
export function byokKey(browserId: string, provider: string): string {
  return `byok:${browserId}:${provider}`;
}

/** Store a BYOK credential blob for a browser session. */
export async function saveByokToOnyx(
  browserId: string,
  provider: string,
  blob: { encryptedKey: string; masked: string; addedAt: string; validatedAt?: string | null; validationError?: string | null },
): Promise<boolean> {
  const result = await onyxSet(byokKey(browserId, provider), blob);
  return result.ok;
}

/** Load a BYOK credential blob for a browser session. */
export async function loadByokFromOnyx(
  browserId: string,
  provider: string,
): Promise<{ encryptedKey: string; masked: string; addedAt: string; validatedAt?: string | null; validationError?: string | null } | null> {
  return onyxGet(byokKey(browserId, provider));
}

/** Remove a BYOK credential for a browser session. */
export async function removeByokFromOnyx(
  browserId: string,
  provider: string,
): Promise<boolean> {
  return onyxDelete(byokKey(browserId, provider));
}

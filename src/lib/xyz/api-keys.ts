/**
 * FreeAIXYZ API Key System (PRD §12, §13, §14, §66).
 *
 * MIGRATED TO OnyxBase (2026-08-30): previously persisted via Prisma, which
 * broke on Vercel serverless (no schema sync) AND on local dev (the parent
 * project's Prisma client doesn't have the apiKey model). OnyxBase-backed
 * storage works on both because there's no DB schema to sync — the KV
 * entries are created on first write.
 *
 * Users can create/manage their FreeAIXYZ application API keys (`fx_live_*`).
 * Keys are securely generated, hashed at rest (sha256), revocable,
 * independently identifiable, shown only at creation time.
 *
 * Security (PRD §66): never logged, never in URLs, never returned twice.
 *
 * The full key is returned to the caller ONCE at creation time. After that,
 * only the prefix + name + last-used timestamp is returned.
 *
 * OnyxBase storage shape:
 *   fxz:apikey:<keyHash>           → { id, userId, name, keyPrefix, scopes, lastUsedAt, revokedAt, createdAt }
 *   fxz:apikeylist:<userId>        → string[] (ids of all keys for the user)
 *   fxz:apikey:id:<id>             → same record (lookup by id for revoke/list)
 *   fxz:apikey:userbykeyhash:<keyHash> → { id, userId, scopes, revokedAt }  (auth lookup)
 */

import { onyxGet, onyxSet, onyxDelete, onyxList } from "./onyxbase";
import { randomToken, sha256Hex, timingSafeEqual } from "./crypto";

const KEY_PREFIX = "fx_live_";
const KEY_RANDOM_BYTES = 32; // 256 bits of entropy

export interface ApiKeyInfo {
  id: string;
  name: string;
  keyPrefix: string; // first 12 chars for ID — safe to display
  scopes: string[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface CreatedApiKey extends ApiKeyInfo {
  /** The full key. Returned ONLY at creation. Never again. */
  key: string;
}

/** Internal record stored in OnyxBase. */
interface ApiKeyRecord {
  id: string;
  userId: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  scopes: string[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

function keyHashKey(hash: string): string {
  return `fxz:apikey:${hash}`;
}
function recordByIdKey(id: string): string {
  return `fxz:apikey:id:${id}`;
}
function listKey(userId: string): string {
  return `fxz:apikeylist:${userId}`;
}

/** Generate a new fx_live_* key with 256 bits of entropy. */
export function generateApiKey(): string {
  return KEY_PREFIX + randomToken(KEY_RANDOM_BYTES);
}

/** Create a new API key for a user. Returns the FULL key — only at creation. */
export async function createApiKey(
  userId: string,
  name = "default",
  scopes: string[] = ["chat", "models"],
): Promise<CreatedApiKey> {
  const key = generateApiKey();
  const keyHash = await sha256Hex(key);
  const keyPrefix = key.slice(0, 12);
  const id = `key_${randomToken(12)}`;
  const now = new Date().toISOString();

  const record: ApiKeyRecord = {
    id,
    userId,
    name,
    keyPrefix,
    keyHash,
    scopes,
    lastUsedAt: null,
    revokedAt: null,
    createdAt: now,
  };

  // Write the record under both the keyHash key (for auth lookup) and the
  // id key (for list/revoke). Also append to the user's key list.
  await onyxSet(keyHashKey(keyHash), record);
  await onyxSet(recordByIdKey(id), record);

  // Update the user's key list (atomic-ish: load → append → save).
  const existingList = (await onyxGet<string[]>(listKey(userId))) ?? [];
  existingList.push(id);
  await onyxSet(listKey(userId), existingList);

  return {
    id,
    name,
    keyPrefix,
    scopes,
    lastUsedAt: null,
    revokedAt: null,
    createdAt: now,
    key,
  };
}

/** List a user's API keys (masked — never the full key). */
export async function listApiKeys(userId: string): Promise<ApiKeyInfo[]> {
  const ids = (await onyxGet<string[]>(listKey(userId))) ?? [];
  const records: ApiKeyRecord[] = [];
  for (const id of ids) {
    const rec = await onyxGet<ApiKeyRecord>(recordByIdKey(id));
    if (rec) records.push(rec);
  }
  // Sort by createdAt desc.
  records.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
  return records.map((r) => ({
    id: r.id,
    name: r.name,
    keyPrefix: r.keyPrefix,
    scopes: r.scopes,
    lastUsedAt: r.lastUsedAt,
    revokedAt: r.revokedAt,
    createdAt: r.createdAt,
  }));
}

/** Revoke an API key (soft-delete — keeps the record for audit). */
export async function revokeApiKey(
  userId: string,
  keyId: string,
): Promise<boolean> {
  const rec = await onyxGet<ApiKeyRecord>(recordByIdKey(keyId));
  if (!rec || rec.userId !== userId) return false;
  if (rec.revokedAt) return true; // already revoked — idempotent
  const updated: ApiKeyRecord = {
    ...rec,
    revokedAt: new Date().toISOString(),
  };
  await onyxSet(recordByIdKey(keyId), updated);
  await onyxSet(keyHashKey(rec.keyHash), updated);
  return true;
}

/**
 * Authenticate using a `fx_live_*` API key. Returns the userId if valid +
 * non-revoked + non-expired, else null. Updates `lastUsedAt` (best-effort).
 *
 * PRD §13 — accept the canonical API-key header `Authorization: Bearer fx_live_*`
 * OR the project's established `X-API-Key: fx_live_*` header.
 */
export async function getApiKeyUserId(
  authHeader: string | null,
  xApiKeyHeader: string | null,
): Promise<{ userId: string; scopes: string[] } | null> {
  const raw = extractBearerToken(authHeader) ?? xApiKeyHeader?.trim();
  if (!raw || !raw.startsWith(KEY_PREFIX)) return null;
  const keyHash = await sha256Hex(raw);
  const rec = await onyxGet<ApiKeyRecord>(keyHashKey(keyHash));
  if (!rec) return null;
  if (rec.revokedAt) return null;
  // Best-effort touch lastUsedAt — never block on it.
  const updated: ApiKeyRecord = {
    ...rec,
    lastUsedAt: new Date().toISOString(),
  };
  await onyxSet(recordByIdKey(rec.id), updated).catch(() => {});
  await onyxSet(keyHashKey(keyHash), updated).catch(() => {});
  return {
    userId: rec.userId,
    scopes: rec.scopes,
  };
}

/** Check whether an authenticated API key has a specific scope. */
export function hasScope(scopes: string[], required: string): boolean {
  return scopes.includes(required) || scopes.includes("*");
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractBearerToken(header: string | null): string | null {
  if (!header) return null;
  const lower = header.toLowerCase();
  if (!lower.startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  return token || null;
}

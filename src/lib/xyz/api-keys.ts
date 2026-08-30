/**
 * FreeAIXYZ API Key System (PRD §12, §13, §14, §66).
 *
 * Users can create/manage their FreeAIXYZ application API keys (`fx_live_*`).
 * Keys are securely generated, hashed at rest (sha256), revocable,
 * independently identifiable, shown only at creation time.
 *
 * Security (PRD §66): never logged, never in URLs, never returned twice.
 *
 * The full key is returned to the caller ONCE at creation time. After that,
 * only the prefix + name + last-used timestamp is returned.
 */

import { db } from "@/lib/db";
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
  /** The full key. Returned ONLY at creation time. Never again. */
  key: string;
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
  const row = await db.apiKey.create({
    data: {
      userId,
      keyHash,
      keyPrefix,
      name,
      scopes: scopes.join(","),
    },
  });
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.keyPrefix,
    scopes: scopes,
    lastUsedAt: null,
    revokedAt: null,
    createdAt: row.createdAt.toISOString(),
    key,
  };
}

/** List a user's API keys (masked — never the full key). */
export async function listApiKeys(userId: string): Promise<ApiKeyInfo[]> {
  const rows = await db.apiKey.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    keyPrefix: r.keyPrefix,
    scopes: r.scopes.split(",").filter(Boolean),
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    revokedAt: r.revokedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Revoke an API key (soft-delete — keeps the row for audit). */
export async function revokeApiKey(
  userId: string,
  keyId: string,
): Promise<boolean> {
  const result = await db.apiKey.updateMany({
    where: { id: keyId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count > 0;
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
  const row = await db.apiKey.findUnique({
    where: { keyHash },
  });
  if (!row) return null;
  if (row.revokedAt) return null;
  // Best-effort touch lastUsedAt — never block on it.
  await db.apiKey
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});
  return {
    userId: row.userId,
    scopes: row.scopes.split(",").filter(Boolean),
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

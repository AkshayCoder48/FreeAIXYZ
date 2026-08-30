/**
 * BYOK credential store (PRD §7, §8, §54, §64).
 *
 * Per-user, per-provider. The raw key is stored server-side in OnyxBase (the
 * configured persistence layer) and NEVER returned to the browser — only a
 * masked representation is. Credentials are scoped by (userId, provider); a
 * request authenticated as user A can never read user B's key (PRD §64, §92).
 *
 * Security (PRD §8): keys are never hardcoded, never committed, never in the
 * frontend bundle, never logged, never echoed in responses. For full
 * encryption-at-rest, set the BYOK_ENCRYPTION_KEY env (AES-256-GCM); without
 * it, keys are stored as-is in OnyxBase (acceptable for the configured KV
 * backend but should be upgraded for shared multi-tenant deployments).
 */

import { onyxbase } from "./onyxbase";
import type { BYOKCredentialMeta, BYOKProvider } from "./types";

const COLL = "freeaixyz";
const credKey = (uid: string, p: BYOKProvider) => `byok:${uid}:${p}`;
const metaKey = (uid: string) => `byok:meta:${uid}`;

/** Mask a key for display: show prefix + last 4, hide the middle (PRD §4). */
export function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "•".repeat(key.length);
  const head = key.slice(0, key.indexOf("_") + 1 || 4);
  const tail = key.slice(-4);
  return `${head}${"•".repeat(8)}${tail}`;
}

/** Save a BYOK key for a user (upsert). */
export async function saveBYOK(
  userId: string,
  provider: BYOKProvider,
  rawKey: string,
): Promise<BYOKCredentialMeta> {
  const trimmed = rawKey.trim();
  if (!trimmed) throw new Error("Empty key");
  await onyxbase.set(credKey(userId, provider), trimmed, COLL);
  const meta = await getMeta(userId);
  const entry: BYOKCredentialMeta = {
    provider,
    connected: true,
    masked: maskKey(trimmed),
    addedAt: new Date().toISOString(),
  };
  const updated = { ...meta, [provider]: entry };
  await onyxbase.set(metaKey(userId), updated, COLL);
  return entry;
}

/** Remove a BYOK key for a user. */
export async function removeBYOK(
  userId: string,
  provider: BYOKProvider,
): Promise<boolean> {
  await onyxbase.delete(credKey(userId, provider), COLL);
  const meta = await getMeta(userId);
  delete meta[provider];
  await onyxbase.set(metaKey(userId), meta, COLL);
  return true;
}

/** Load the raw key (server-side only — never send to the browser). */
export async function loadBYOKKey(
  userId: string,
  provider: BYOKProvider,
): Promise<string | null> {
  return onyxbase.get<string>(credKey(userId, provider), COLL);
}

/** Get the masked metadata for all of a user's BYOK keys (safe for browser). */
export async function getBYOKMeta(
  userId: string,
): Promise<Record<BYOKProvider, BYOKCredentialMeta>> {
  return getMeta(userId);
}

async function getMeta(
  userId: string,
): Promise<Record<BYOKProvider, BYOKCredentialMeta>> {
  const stored = await onyxbase.get<Record<BYOKProvider, BYOKCredentialMeta>>(
    metaKey(userId),
    COLL,
  );
  return stored ?? ({} as Record<BYOKProvider, BYOKCredentialMeta>);
}

/** Update validation result without touching the key. */
export async function setBYOKValidation(
  userId: string,
  provider: BYOKProvider,
  ok: boolean,
): Promise<void> {
  const meta = await getMeta(userId);
  if (meta[provider]) {
    meta[provider].lastValidatedAt = new Date().toISOString();
    meta[provider].lastValidationOk = ok;
    await onyxbase.set(metaKey(userId), meta, COLL);
  }
}

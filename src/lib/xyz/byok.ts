/**
 * BYOK credential store — OnyxBase-backed, keyed by authenticated userId.
 *
 * Per-user, per-provider. The raw key is encrypted-at-rest (AES-256-GCM)
 * and stored in OnyxBase under `fxz:byok:{userId}:{provider}`. The raw key
 * is NEVER returned to the browser — only a masked representation.
 *
 * WHY userId (not a browser-local UUID):
 *   The user signs in with email (direct login, no OTP). The session cookie
 *   resolves to a stable userId on every request. BYOK keys are stored
 *   against that userId in OnyxBase (server-side), so they:
 *     - persist across page refresh (the cookie + OnyxBase record survive)
 *     - persist across tab changes / new tabs (same cookie)
 *     - persist across devices (same email login → same userId → same keys)
 *   This is the fix for "key getting deleted after tab change or refresh".
 *
 * Security: keys are never hardcoded, never committed, never in the
 * frontend bundle, never logged, never echoed in responses, never in URLs.
 */

import {
  decryptString,
  encryptString,
  keyPrefix,
  keySuffix,
  maskKey,
} from "./crypto";
import type { BYOKCredentialMeta, BYOKProvider } from "./types";
import {
  saveByokToOnyx,
  loadByokFromOnyx,
  removeByokFromOnyx,
} from "./onyxbase";

const PROVIDERS: BYOKProvider[] = ["gratisfy", "g4f", "pollinations"];

/** Mask a key for display: show prefix + dots + last 4. */
export function maskKeyPublic(key: string): string {
  return maskKey(key);
}

/** Save a BYOK key for a user (upsert). Encrypts-at-rest before persisting. */
export async function saveBYOK(
  userId: string,
  provider: BYOKProvider,
  rawKey: string,
): Promise<BYOKCredentialMeta> {
  const trimmed = rawKey.trim();
  if (!trimmed) throw new Error("Empty key");

  const enc = await encryptString(trimmed);
  const masked = maskKey(trimmed);
  const addedAt = new Date().toISOString();

  await saveByokToOnyx(userId, provider, {
    encryptedKey: JSON.stringify(enc),
    masked,
    addedAt,
    validatedAt: null,
    validationError: null,
  });

  return {
    provider,
    connected: true,
    masked,
    addedAt,
  };
}

/** Remove a BYOK key for a user. */
export async function removeBYOK(
  userId: string,
  provider: BYOKProvider,
): Promise<boolean> {
  return removeByokFromOnyx(userId, provider);
}

/** Load the raw key (server-side only — never send to the browser). */
export async function loadBYOKKey(
  userId: string,
  provider: BYOKProvider,
): Promise<string | null> {
  const blob = await loadByokFromOnyx(userId, provider);
  if (!blob) return null;
  try {
    const enc = JSON.parse(blob.encryptedKey) as {
      ct: string;
      iv: string;
      tag: string;
    };
    return await decryptString(enc);
  } catch {
    // Decryption failed — key is corrupt or encryption key rotated. Treat as
    // missing; user must re-enter the key.
    return null;
  }
}

/** Get the masked metadata for all of a user's BYOK keys (safe for browser). */
export async function getBYOKMeta(
  userId: string,
): Promise<Record<BYOKProvider, BYOKCredentialMeta>> {
  const result = {} as Record<BYOKProvider, BYOKCredentialMeta>;
  for (const p of PROVIDERS) {
    const blob = await loadByokFromOnyx(userId, p);
    if (blob) {
      result[p] = {
        provider: p,
        connected: true,
        masked: blob.masked,
        addedAt: blob.addedAt,
        lastValidatedAt: blob.validatedAt ?? undefined,
        lastValidationOk: blob.validatedAt ? !blob.validationError : undefined,
      };
    } else {
      result[p] = {
        provider: p,
        connected: false,
        masked: "",
        addedAt: "",
      };
    }
  }
  return result;
}

/** Update validation result without touching the key. */
export async function setBYOKValidation(
  userId: string,
  provider: BYOKProvider,
  ok: boolean,
  errorMessage?: string,
): Promise<void> {
  const blob = await loadByokFromOnyx(userId, provider);
  if (!blob) return;
  blob.validatedAt = new Date().toISOString();
  blob.validationError = ok ? null : (errorMessage ?? "Validation failed");
  await saveByokToOnyx(userId, provider, blob);
}

/**
 * BYOK credential store (PRD §9, §10, §16, §66–68).
 *
 * Per-user, per-provider. The raw key is encrypted-at-rest (AES-256-GCM) and
 * stored in Prisma. The raw key is NEVER returned to the browser — only a
 * masked representation (prefix + dots + last 4) is exposed.
 *
 * Credentials are scoped by (userId, provider); a request authenticated as
 * user A can never read user B's key (PRD §67, §68). The `userId` is always
 * derived from the authenticated session/API key on the server, never from
 * client-supplied data.
 *
 * Security (PRD §66): keys are never hardcoded, never committed, never in the
 * frontend bundle, never logged, never echoed in responses, never in URLs.
 */

import { db } from "@/lib/db";
import {
  decryptString,
  encryptString,
  keyPrefix,
  keySuffix,
  maskKey,
} from "./crypto";
import type { BYOKCredentialMeta, BYOKProvider } from "./types";

const PROVIDERS: BYOKProvider[] = ["gratisfy", "g4f"];

/** Mask a key for display: show prefix + dots + last 4 (PRD §4, §16). */
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
  const encryptedKey = JSON.stringify(enc);
  const prefix = keyPrefix(trimmed);
  const suffix = keySuffix(trimmed);

  // Upsert (userId, provider) is unique.
  await db.byokCredential.upsert({
    where: { userId_provider: { userId, provider } },
    create: {
      userId,
      provider,
      encryptedKey,
      keyIv: enc.iv,
      keyTag: enc.tag,
      keyPrefix: prefix,
      keySuffix: suffix,
      validatedAt: null,
      validationError: null,
    },
    update: {
      encryptedKey,
      keyIv: enc.iv,
      keyTag: enc.tag,
      keyPrefix: prefix,
      keySuffix: suffix,
      validatedAt: null,
      validationError: null,
    },
  });

  return {
    provider,
    connected: true,
    masked: maskKey(trimmed),
    addedAt: new Date().toISOString(),
  };
}

/** Remove a BYOK key for a user. */
export async function removeBYOK(
  userId: string,
  provider: BYOKProvider,
): Promise<boolean> {
  await db.byokCredential.deleteMany({ where: { userId, provider } });
  return true;
}

/** Load the raw key (server-side only — never send to the browser). */
export async function loadBYOKKey(
  userId: string,
  provider: BYOKProvider,
): Promise<string | null> {
  const row = await db.byokCredential.findUnique({
    where: { userId_provider: { userId, provider } },
  });
  if (!row) return null;
  try {
    const enc = JSON.parse(row.encryptedKey) as {
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
  const rows = await db.byokCredential.findMany({ where: { userId } });
  const result = {} as Record<BYOKProvider, BYOKCredentialMeta>;
  for (const p of PROVIDERS) {
    const row = rows.find((r) => r.provider === p);
    if (row) {
      const masked = `${row.keyPrefix}${"•".repeat(8)}${row.keySuffix}`;
      result[p] = {
        provider: p,
        connected: true,
        masked,
        addedAt: row.createdAt.toISOString(),
        lastValidatedAt: row.validatedAt?.toISOString(),
        lastValidationOk: row.validatedAt ? !row.validationError : undefined,
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
  await db.byokCredential.updateMany({
    where: { userId, provider },
    data: {
      validatedAt: new Date(),
      validationError: ok ? null : errorMessage ?? "Validation failed",
    },
  });
}

// ─── OnyxBase-backed BYOK (anonymous browser mode) ───────────────────────────
//
// These functions store BYOK credentials in OnyxBase (Telegram-backed KV)
// keyed by an anonymous browser ID instead of a signed-in userId. This lets
// users save/test/remove BYOK keys WITHOUT signing in. The browser
// generates a random UUID stored in localStorage and sends it as the
// `X-Browser-Id` header.
//
// The raw key is still encrypted-at-rest (AES-256-GCM) before being written
// to OnyxBase, so OnyxBase never sees plaintext. We store the encrypted
// blob + masked display string.

import {
  saveByokToOnyx,
  loadByokFromOnyx,
  removeByokFromOnyx,
} from "./onyxbase";

interface OnyxBrowserByokBlob {
  encryptedKey: string;
  masked: string;
  addedAt: string;
  validatedAt?: string | null;
  validationError?: string | null;
}

/** Save a BYOK key for an anonymous browser session (OnyxBase-backed). */
export async function saveBrowserByok(
  browserId: string,
  provider: BYOKProvider,
  rawKey: string,
): Promise<BYOKCredentialMeta> {
  const trimmed = rawKey.trim();
  if (!trimmed) throw new Error("Empty key");
  if (browserId === "anonymous") {
    throw new Error("Browser ID is required to save a key.");
  }
  const enc = await encryptString(trimmed);
  const blob: OnyxBrowserByokBlob = {
    encryptedKey: JSON.stringify(enc),
    masked: maskKey(trimmed),
    addedAt: new Date().toISOString(),
    validatedAt: null,
    validationError: null,
  };
  await saveByokToOnyx(browserId, provider, blob);
  return {
    provider,
    connected: true,
    masked: blob.masked,
    addedAt: blob.addedAt,
  };
}

/** Remove a BYOK key for an anonymous browser session (OnyxBase-backed). */
export async function removeBrowserByok(
  browserId: string,
  provider: BYOKProvider,
): Promise<boolean> {
  return removeByokFromOnyx(browserId, provider);
}

/** Load the raw key for an anonymous browser session (server-side only). */
export async function loadBrowserByokKey(
  browserId: string,
  provider: BYOKProvider,
): Promise<string | null> {
  const blob = await loadByokFromOnyx(browserId, provider);
  if (!blob) return null;
  try {
    const enc = JSON.parse(blob.encryptedKey) as {
      ct: string;
      iv: string;
      tag: string;
    };
    return await decryptString(enc);
  } catch {
    return null;
  }
}

/** Get masked metadata for all BYOK keys for a browser session. */
export async function getBrowserByokMeta(
  browserId: string,
): Promise<Record<BYOKProvider, BYOKCredentialMeta>> {
  const result = {} as Record<BYOKProvider, BYOKCredentialMeta>;
  for (const p of PROVIDERS) {
    if (browserId === "anonymous") {
      result[p] = { provider: p, connected: false, masked: "", addedAt: "" };
      continue;
    }
    const blob = await loadByokFromOnyx(browserId, p);
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
      result[p] = { provider: p, connected: false, masked: "", addedAt: "" };
    }
  }
  return result;
}

/** Update validation state for a browser BYOK key (OnyxBase-backed). */
export async function setBrowserByokValidation(
  browserId: string,
  provider: BYOKProvider,
  ok: boolean,
  errorMessage?: string,
): Promise<void> {
  const blob = await loadByokFromOnyx(browserId, provider);
  if (!blob) return;
  blob.validatedAt = new Date().toISOString();
  blob.validationError = ok ? null : (errorMessage ?? "Validation failed");
  await saveByokToOnyx(browserId, provider, blob);
}

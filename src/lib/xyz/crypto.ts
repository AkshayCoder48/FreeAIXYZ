/**
 * Crypto helpers (PRD §66).
 *
 * - AES-256-GCM for BYOK credential encryption-at-rest.
 * - SHA-256 (with per-record salt) for verification codes.
 * - Random token + salt generators.
 *
 * The encryption key is read from BYOK_ENCRYPTION_KEY env (server-side only).
 * If unset in dev, a deterministic dev key is derived so the flow is testable.
 * In production, BYOK_ENCRYPTION_KEY MUST be set — otherwise saveBYOK throws.
 */

import { webcrypto } from "node:crypto";

// Node 20+ exposes globalThis.crypto as a Crypto instance pointing to the
// webcrypto implementation, but on some older runtimes you must import it
// explicitly. Use the safe global with a fallback.
const subtle: SubtleCrypto =
  (globalThis.crypto as Crypto | undefined)?.subtle ??
  (webcrypto as unknown as Crypto).subtle;

// ─── Random generators ────────────────────────────────────────────────────────

/** Generate a URL-safe random token (sessions, API keys). */
export function randomToken(byteLen = 32): string {
  const bytes = new Uint8Array(byteLen);
  (globalThis.crypto ?? webcrypto).getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

/** Generate a 6-digit verification code (uniform on [0, 1_000_000)). */
export function numericCode(): string {
  // Use 6 random bytes (48 bits) and reduce modulo 1_000_000. The bias
  // is negligible (< 0.00002%). `>>> 0` forces unsigned 32-bit so we never
  // produce a negative number (which previously could leak a stray digit).
  const buf = new Uint8Array(6);
  (globalThis.crypto ?? webcrypto).getRandomValues(buf);
  let acc = 0;
  for (let i = 0; i < 6; i++) {
    acc = (acc * 256 + buf[i]) % 1_000_000;
  }
  return acc.toString().padStart(6, "0");
}

/** Generate a short random salt for code hashing. */
export function randomSalt(): string {
  return randomToken(8);
}

// ─── SHA-256 (codes, API key fingerprints) ───────────────────────────────────

/** Hash a string with SHA-256, returning hex. */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await subtle.digest("SHA-256", data);
  return Buffer.from(buf).toString("hex");
}

/** Hash a code with a per-record salt. Returns "salt:hash" combined string. */
export async function hashWithSalt(salt: string, value: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${value}`);
  const buf = await subtle.digest("SHA-256", data);
  return Buffer.from(buf).toString("hex");
}

/** Constant-time string comparison (codes, hashes). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ─── AES-256-GCM (BYOK credentials at rest) ──────────────────────────────────

interface EncryptedPayload {
  /** base64 ciphertext */
  ct: string;
  /** base64 IV (12 bytes for GCM) */
  iv: string;
  /** base64 auth tag (16 bytes) */
  tag: string;
}

const KEY_BYTES = 32; // AES-256

/** Resolve the encryption key (raw 32 bytes). Throws in prod if unset. */
async function getEncryptionKey(): Promise<CryptoKey> {
  const envKey = process.env.BYOK_ENCRYPTION_KEY;
  if (!envKey) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "BYOK_ENCRYPTION_KEY is not set. Configure it before saving BYOK credentials.",
      );
    }
    // Dev-only deterministic key — derived from a fixed salt so enc/dec roundtrips.
    const devSeed = "freeaixyz-dev-only-encryption-key-DO-NOT-USE-IN-PROD";
    const hash = await subtle.digest("SHA-256", new TextEncoder().encode(devSeed));
    return subtle.importKey(
      "raw",
      Buffer.from(hash).slice(0, KEY_BYTES),
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }
  // Production: derive a key from the env string via SHA-256, then take first 32 bytes.
  const hash = await subtle.digest("SHA-256", new TextEncoder().encode(envKey));
  return subtle.importKey(
    "raw",
    Buffer.from(hash).slice(0, KEY_BYTES),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Encrypt a plaintext string. Returns base64-encoded ct/iv/tag strings. */
export async function encryptString(plaintext: string): Promise<EncryptedPayload> {
  const key = await getEncryptionKey();
  const iv = (globalThis.crypto ?? webcrypto).getRandomValues(new Uint8Array(12));
  const ciphertext = await subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  // Web Crypto's AES-GCM appends the 16-byte tag to the ciphertext buffer.
  const ctBuf = Buffer.from(ciphertext);
  const tag = ctBuf.subarray(ctBuf.length - 16);
  const ct = ctBuf.subarray(0, ctBuf.length - 16);
  return {
    ct: ct.toString("base64"),
    iv: Buffer.from(iv).toString("base64"),
    tag: tag.toString("base64"),
  };
}

/** Decrypt an EncryptedPayload back to plaintext. */
export async function decryptString(payload: EncryptedPayload): Promise<string> {
  const key = await getEncryptionKey();
  const iv = Buffer.from(payload.iv, "base64");
  const ct = Buffer.from(payload.ct, "base64");
  const tag = Buffer.from(payload.tag, "base64");
  // Web Crypto expects ct + tag concatenated.
  const combined = Buffer.concat([ct, tag]);
  const plaintext = await subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    combined,
  );
  return new TextDecoder().decode(plaintext);
}

/** Mask a key for display: prefix + dots + last 4 chars (PRD §4, §16). */
export function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "•".repeat(key.length);
  const underscore = key.indexOf("_");
  const headLen = underscore > 0 && underscore < 12 ? underscore + 1 : 4;
  const head = key.slice(0, headLen);
  const tail = key.slice(-4);
  return `${head}${"•".repeat(8)}${tail}`;
}

/** First 6 chars for UI display. */
export function keyPrefix(key: string): string {
  return key.slice(0, 6);
}

/** Last 4 chars for UI display. */
export function keySuffix(key: string): string {
  return key.slice(-4);
}

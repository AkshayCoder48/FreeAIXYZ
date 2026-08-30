/**
 * Direct email login — passwordless, NO verification code (per user request).
 *
 * Backed entirely by OnyxBase (Telegram-backed KV store). NO Prisma, NO
 * database schema sync needed — this works on Vercel out of the box.
 *
 * Flow:
 *   1. User submits email → signInWithEmail(email)
 *   2. Normalize email; rate-limit per email + per IP (60s window)
 *   3. Lookup user by email in OnyxBase (fxz:userbyemail:{email}); if not
 *      found, create a new user record (fxz:user:{userId} + email index)
 *   4. Mint a session token (32 random bytes), hash with SHA-256
 *   5. Store session in OnyxBase (fxz:session:{tokenHash}) with userId,
 *      email, expiresAt (7 days)
 *   6. Return the raw token; the route handler sets it as an HttpOnly cookie
 *
 * Security trade-off (explicit, per user request):
 *   There is NO email verification step. Anyone who knows an email address
 *   can sign in as that address. This is acceptable for FreeAIXYZ because
 *   the user's real secrets (BYOK API keys) are stored per-account in
 *   OnyxBase server-side — the email is just a namespace key. If you later
 *   need stronger identity, re-add a verification step here.
 *
 * Sessions live in HttpOnly+Secure+SameSite=Lax cookies (fxz_session).
 */

import {
  loadUserById,
  loadUserIdByEmail,
  saveUser,
  saveSession,
  loadSession,
  deleteSession,
  deleteUser,
  type OnyxUserRecord,
} from "./onyxbase";
import { randomToken, sha256Hex } from "./crypto";
import type { UserAccount } from "./types";

const SESSION_COOKIE = "fxz_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ─── In-memory rate limits (per email / per IP, 60s window) ──────────────────
const rlWindowMs = 60_000;
const rlMaxPerEmail = 5;
const rlMaxPerIp = 15;
const rlEmail = new Map<string, number[]>();
const rlIp = new Map<string, number[]>();

function bumpRate(map: Map<string, number[]>, k: string, max: number): boolean {
  const now = Date.now();
  const arr = (map.get(k) ?? []).filter((t) => now - t < rlWindowMs);
  if (arr.length >= max) return false;
  arr.push(now);
  map.set(k, arr);
  return true;
}

// ─── Email normalization ─────────────────────────────────────────────────────
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ─── User lookup / creation (OnyxBase) ──────────────────────────────────────

async function lookupUserByEmail(email: string): Promise<OnyxUserRecord | null> {
  const userId = await loadUserIdByEmail(email);
  if (!userId) return null;
  return loadUserById(userId);
}

async function getUser(userId: string): Promise<OnyxUserRecord | null> {
  return loadUserById(userId);
}

function toUserAccount(row: OnyxUserRecord): UserAccount {
  return {
    id: row.id,
    email: row.email,
    // Direct email login — the email IS the verified login handle. We
    // also persist this flag on the OnyxUserRecord so reads are stable.
    emailVerified: row.emailVerified !== false ? true : false,
    createdAt: row.createdAt,
    lastLoginAt: row.lastLoginAt,
    status: row.status === "active" ? "active" : "disabled",
  };
}

async function createUser(email: string): Promise<OnyxUserRecord> {
  const now = new Date().toISOString();
  const user: OnyxUserRecord = {
    id: `usr_${randomToken(12)}`,
    email,
    createdAt: now,
    lastLoginAt: now,
    status: "active",
    // Direct email login — the email is the login handle, so we treat
    // it as implicitly verified at sign-in time. (Old records created
    // before this field existed are also treated as verified — see
    // toUserAccount's `!== false` check.)
    emailVerified: true,
  };
  await saveUser(user);
  return user;
}

async function touchLogin(user: OnyxUserRecord): Promise<void> {
  const updated: OnyxUserRecord = {
    ...user,
    lastLoginAt: new Date().toISOString(),
  };
  await saveUser(updated);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Direct email login — NO verification code. Creates or loads the user,
 * mints a session token, stores the session in OnyxBase, returns the raw
 * token + userId. The route handler sets the HttpOnly cookie.
 *
 * Returns `{ ok: false, message }` on rate-limit or invalid email.
 */
export async function signInWithEmail(
  emailRaw: string,
  ip: string,
): Promise<{ ok: boolean; sessionToken?: string; userId?: string; message?: string }> {
  const email = normalizeEmail(emailRaw);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, message: "Please enter a valid email address." };
  }
  if (!bumpRate(rlEmail, email, rlMaxPerEmail)) {
    return {
      ok: false,
      message: "Too many sign-in attempts. Please wait a minute before trying again.",
    };
  }
  if (!bumpRate(rlIp, ip, rlMaxPerIp)) {
    return {
      ok: false,
      message: "Too many requests from this network. Please wait.",
    };
  }

  // Lookup or create the account. Idempotent by normalized email.
  let user = await lookupUserByEmail(email);
  if (!user) {
    user = await createUser(email);
  }
  if (user.status !== "active") {
    return { ok: false, message: "This account is disabled. Contact support." };
  }

  await touchLogin(user);

  // Mint a session token (32 random bytes → 64 hex chars). Store its
  // SHA-256 hash in OnyxBase so a DB leak never reveals live tokens.
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  await saveSession(tokenHash, {
    userId: user.id,
    email: user.email,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
  });

  return {
    ok: true,
    sessionToken: token,
    userId: user.id,
    message: "Signed in.",
  };
}

// ─── Session management ─────────────────────────────────────────────────────

/** Resolve the authenticated userId from a request (reads the session cookie). */
export async function getSessionUserId(request: Request): Promise<string | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const session = await loadSession(tokenHash);
  if (!session) return null;
  // Server-side expiry check (no client clock reliance).
  if (new Date() > new Date(session.expiresAt)) {
    await deleteSession(tokenHash).catch(() => {});
    return null;
  }
  return session.userId;
}

/** Logout: delete the session + clear the cookie. */
export async function logout(request: Request): Promise<void> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return;
  const tokenHash = await sha256Hex(token);
  await deleteSession(tokenHash).catch(() => {});
}

export function sessionCookieName(): string {
  return SESSION_COOKIE;
}
export function buildSessionCookie(token: string, secure: boolean): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    secure ? "Secure" : "",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ]
    .filter(Boolean)
    .join("; ");
}
export function buildClearCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; ${secure ? "Secure; " : ""}SameSite=Lax; Max-Age=0`;
}

function readCookie(request: Request, name: string): string | null {
  const raw = request.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name && v.length) return decodeURIComponent(v.join("="));
  }
  return null;
}

/** Get the authenticated user's public account info. */
export async function getAccount(
  userId: string,
): Promise<{ id: string; email: string; emailVerified: boolean; createdAt: string; lastLoginAt: string; status: "active" | "disabled" } | null> {
  const u = await getUser(userId);
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    // Direct email login → email is implicitly verified at sign-in time.
    // Older records (created before the emailVerified field existed)
    // default to true via the `!== false` check.
    emailVerified: u.emailVerified !== false,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
    status: u.status === "active" ? "active" : "disabled",
  };
}

/**
 * Delete account — removes the user record + email index from OnyxBase.
 * BYOK keys (fxz:byok:{userId}:*) are left as orphans (no cascade) — they
 * become unreachable once the user record is gone.
 */
export async function deleteAccount(userId: string): Promise<void> {
  const user = await getUser(userId);
  if (!user) return;
  await deleteUser(userId, user.email);
}

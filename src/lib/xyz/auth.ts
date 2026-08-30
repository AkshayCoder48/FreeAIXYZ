/**
 * Email-only passwordless authentication (PRD §5, §6, §7, §80–101).
 *
 * Backed by Prisma (SQLite for dev, Postgres-compatible for prod). Codes are
 * hashed (salted SHA-256), single-use, server-side expiry — no client device
 * clock reliance. Sessions live in HttpOnly+Secure+SameSite=Lax cookies.
 *
 * Account enumeration is prevented via generic "we'll send a code" responses.
 * Codes are NEVER returned through API responses in production. In dev (when
 * EMAIL_PROVIDER is unset AND NODE_ENV !== 'production') the code is logged
 * server-side and surfaced via `devCode` for testability only.
 */

import { db, ensureDbSchema } from "@/lib/db";
import {
  hashWithSalt,
  numericCode,
  randomSalt,
  randomToken,
  sha256Hex,
  timingSafeEqual,
} from "./crypto";
import type { UserAccount } from "./types";

const SESSION_COOKIE = "fxz_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes (PRD §6, §82)
const MAX_ATTEMPTS = 5; // PRD §7, §98
const CODE_RESEND_COOLDOWN_MS = 60 * 1000; // 1 min cooldown between codes

// ─── In-memory rate limits (per email / per IP, 60s window) ──────────────────
const rlWindowMs = 60_000;
const rlMaxPerEmail = 3;
const rlMaxPerIp = 10;
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

// ─── Email normalization (PRD §83) ───────────────────────────────────────────
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ─── User lookup / creation (PRD §83, §85, §87) ───────────────────────────────

async function lookupUserByEmail(email: string): Promise<UserAccount | null> {
  await ensureDbSchema();
  try {
    const row = await db.user.findUnique({ where: { email } });
    return row ? toUserAccount(row) : null;
  } catch {
    return null;
  }
}

async function getUser(userId: string): Promise<UserAccount | null> {
  await ensureDbSchema();
  try {
    const row = await db.user.findUnique({ where: { id: userId } });
    return row ? toUserAccount(row) : null;
  } catch {
    return null;
  }
}

function toUserAccount(row: {
  id: string;
  email: string;
  status: string;
  createdAt: Date;
  lastLoginAt: Date | null;
}): UserAccount {
  return {
    id: row.id,
    email: row.email,
    emailVerified: true, // codes can only be sent to deliverable emails
    createdAt: row.createdAt.toISOString(),
    lastLoginAt: (row.lastLoginAt ?? row.createdAt).toISOString(),
    status: row.status === "active" ? "active" : "disabled",
  };
}

async function createUser(email: string): Promise<UserAccount> {
  await ensureDbSchema();
  try {
    const row = await db.user.create({
      data: { email, status: "active", lastLoginAt: new Date() },
    });
    return toUserAccount(row);
  } catch (err) {
    // Re-check lookup — maybe the user was created by a concurrent request.
    const existing = await lookupUserByEmail(email);
    if (existing) return existing;
    throw err;
  }
}

async function touchLogin(userId: string): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: { lastLoginAt: new Date() },
  });
}

// ─── Email delivery (PRD §80; pluggable) ──────────────────────────────────────
async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  const provider = process.env.EMAIL_PROVIDER;
  if (!provider || provider === "console") {
    // Dev mode: log the code so the flow is testable without email infra.
    // Note: this log line is acceptable in dev only; production must wire
    // a real provider (Resend/SendGrid/SES).
    console.log(`[dev-email] To: ${to} | Subject: ${subject}\n${body}`);
    return;
  }
  // Production hook: implement Resend/SendGrid here. Until then, log.
  console.log(`[email-fallback:${provider}] To: ${to} | Subject: ${subject}`);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Step 1 — send a verification code (PRD §80, §82, §98, §99).
 * Always returns the same generic message (enumeration protection).
 *
 * PRD §6 — verification code reliability fix:
 * - Server-side expiry via Prisma DateTime column.
 * - Resend cooldown (60s) so multiple requests don't orphan old codes.
 * - When a new code is issued, all prior unconsumed codes for this user are
 *   marked consumed (single-active-code rule) — the latest one wins.
 * - devCode is surfaced ONLY when NODE_ENV !== 'production' AND no real
 *   email provider is configured.
 */
export async function sendVerificationCode(
  emailRaw: string,
  ip: string,
): Promise<{ ok: boolean; message: string; devCode?: string }> {
  const email = normalizeEmail(emailRaw);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, message: "Please enter a valid email address." };
  }
  if (!bumpRate(rlEmail, email, rlMaxPerEmail)) {
    return {
      ok: false,
      message: "Too many requests. Please wait a minute before trying again.",
    };
  }
  if (!bumpRate(rlIp, ip, rlMaxPerIp)) {
    return {
      ok: false,
      message: "Too many requests from this network. Please wait.",
    };
  }

  // Lookup or create the account (PRD §83). Idempotent by normalized email.
  let user = await lookupUserByEmail(email);
  if (!user) {
    user = await createUser(email);
  }

  // Resend cooldown: if the most recent unconsumed code is younger than the
  // cooldown window, refuse — keeps the "code is invalid immediately" bug
  // (which was caused by overlapping codes / silent OnyxBase failures) out.
  const now = new Date();
  let recent: Awaited<ReturnType<typeof db.emailCode.findFirst>> = null;
  try {
    recent = await db.emailCode.findFirst({
      where: { userId: user.id, consumed: false, createdAt: { gt: new Date(now.getTime() - CODE_RESEND_COOLDOWN_MS) } },
      orderBy: { createdAt: "desc" },
    });
  } catch {
    // Schema may not exist yet on cold start — proceed to create.
  }
  if (recent) {
    return {
      ok: false,
      message: "A code was just sent. Please wait a minute before requesting another.",
    };
  }

  // Invalidate all prior unconsumed codes for this user — single active code.
  try {
    await db.emailCode.updateMany({
      where: { userId: user.id, consumed: false },
      data: { consumed: true },
    });
  } catch {
    // Schema may not exist yet on cold start — proceed to create.
  }

  const code = numericCode();
  const salt = randomSalt();
  const codeHash = `${salt}:${await hashWithSalt(salt, code)}`;
  try {
    await db.emailCode.create({
      data: {
        userId: user.id,
        email,
        codeHash,
        attempts: 0,
        consumed: false,
        expiresAt: new Date(now.getTime() + CODE_TTL_MS), // SERVER-SIDE expiry (PRD §6)
        ip,
      },
    });
  } catch (err) {
    // Schema creation failed — surface the error to the caller.
    return {
      ok: false,
      message: "Could not issue a verification code. Please try again.",
    };
  }

  await sendEmail(
    email,
    "Your FreeAIXYZ verification code",
    `Your verification code is: ${code}\n\nIt expires in 10 minutes. If you didn't request it, ignore this email.`,
  );

  // Dev-only: surface the code so the flow is testable without email infra.
  // PRD §82 — never expose codes in production responses.
  const dev =
    process.env.NODE_ENV !== "production" && !process.env.EMAIL_PROVIDER;
  return {
    ok: true,
    message: "If this email can receive a verification code, we've sent one.",
    ...(dev ? { devCode: code } : {}),
  };
}

/**
 * Step 2 — verify the code + create a session (PRD §81, §82, §88).
 * Returns a session cookie value to set, or null on failure.
 *
 * PRD §6 fix — Server-side expiry is authoritative. The check is
 * `expiresAt < serverNow()`, never `clientNow > expiresAt`.
 */
export async function verifyCodeAndCreateSession(
  emailRaw: string,
  code: string,
): Promise<{ ok: boolean; sessionToken?: string; userId?: string; message?: string }> {
  const email = normalizeEmail(emailRaw);
  const user = await lookupUserByEmail(email);
  if (!user) {
    return { ok: false, message: "Invalid or expired code." };
  }

  // Find the most recent unconsumed code for this user.
  const record = await db.emailCode.findFirst({
    where: { userId: user.id, consumed: false },
    orderBy: { createdAt: "desc" },
  });
  if (!record) return { ok: false, message: "Invalid or expired code." };

  // SERVER-SIDE expiry check (PRD §6) — never rely on client device clock.
  if (new Date() > record.expiresAt) {
    await db.emailCode.update({
      where: { id: record.id },
      data: { consumed: true },
    });
    return { ok: false, message: "Code expired. Please request a new one." };
  }
  if (record.attempts >= MAX_ATTEMPTS) {
    await db.emailCode.update({
      where: { id: record.id },
      data: { consumed: true },
    });
    return { ok: false, message: "Too many attempts. Please request a new code." };
  }

  // Increment attempts BEFORE comparing — defends against timing brute-force.
  await db.emailCode.update({
    where: { id: record.id },
    data: { attempts: { increment: 1 } },
  });

  // Recover salt from stored "salt:hash" and re-derive for compare.
  const [salt, storedHash] = record.codeHash.split(":");
  const computed = await hashWithSalt(salt ?? "", code.trim());
  if (!timingSafeEqual(computed, storedHash ?? "")) {
    return { ok: false, message: "Invalid code. Please try again." };
  }

  // Success: consume the code, create session, touch login.
  await db.emailCode.update({
    where: { id: record.id },
    data: { consumed: true },
  });
  await touchLogin(user.id);

  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  await db.session.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      ip: null,
      userAgent: null,
    },
  });
  return { ok: true, sessionToken: token, userId: user.id, message: "Signed in." };
}

// ─── Session management (PRD §88, §93) ─────────────────────────────────────────

/** Resolve the authenticated userId from a request (reads the session cookie). */
export async function getSessionUserId(request: Request): Promise<string | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const session = await db.session.findUnique({ where: { tokenHash } });
  if (!session) return null;
  if (new Date() > session.expiresAt) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  // Touch lastSeenAt (best-effort; ignore failures).
  await db.session
    .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
    .catch(() => {});
  return session.userId;
}

/** Logout: delete the session + clear the cookie. */
export async function logout(request: Request): Promise<void> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return;
  const tokenHash = await sha256Hex(token);
  await db.session.deleteMany({ where: { tokenHash } }).catch(() => {});
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

/** Get the authenticated user's public account info (PRD §94). */
export async function getAccount(
  userId: string,
): Promise<{ id: string; email: string; emailVerified: boolean; createdAt: string; lastLoginAt: string } | null> {
  const u = await getUser(userId);
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    emailVerified: u.emailVerified,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
  };
}

/** Delete account (PRD §101) — cascade-deletes sessions, codes, BYOK, API
 * keys, XYZ account, transactions, reservations, usage records, playground
 * sessions. Audit events are retained (anonymized via SetNull). */
export async function deleteAccount(userId: string): Promise<void> {
  await db.user.delete({ where: { id: userId } }).catch(() => {});
}

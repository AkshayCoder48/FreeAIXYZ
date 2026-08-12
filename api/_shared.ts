// Shared server-side helpers for Vercel Functions and the Vite dev shims.
// Files prefixed with "_" are not treated as routes by Vercel.
//
// CHANGES FROM ORIGINAL:
// - REMOVED: Upstash Redis rate limiting (no external Redis dependency)
// - REMOVED: Cloudflare Pages deployment (replaced by Puter.js browser SDK)
// - REMOVED: Server-side Puter.js deploy (now fully client-side via browser SDK)
// - ADDED:   E2B sandbox integration for filesystem & runtime execution
import { createCipheriv, createDecipheriv, randomBytes, hkdfSync } from 'node:crypto'

// ---------------------------------------------------------------------------
// Supabase JWT verification
// ---------------------------------------------------------------------------

export interface AuthedUser {
  id: string
  email?: string
}

function supabaseEnv(): { url: string; anonKey: string } | null {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !anonKey) return null
  return { url, anonKey }
}

/** Extract the bearer token from an Authorization header value. */
function bearer(authorization: string | undefined): string {
  return (authorization || '').replace(/^Bearer\s+/i, '').trim()
}

/**
 * Verify a Supabase access token by calling the Auth API. Returns the user on
 * success, or null if the token is missing/invalid or the server is not
 * configured with Supabase credentials.
 */
export async function verifyUser(authorization: string | undefined): Promise<AuthedUser | null> {
  const token = bearer(authorization)
  if (!token) return null

  const env = supabaseEnv()
  if (!env) return null

  try {
    const res = await fetch(`${env.url}/auth/v1/user`, {
      headers: { apikey: env.anonKey, Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return null
    const data = (await res.json()) as { id?: string; email?: string }
    if (!data?.id) return null
    return { id: data.id, email: data.email }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Project ownership lookup (for the deploy endpoint)
//
// The site id is authoritative in the database, not in the request body.
// Deriving it server-side (scoped to the caller's JWT via RLS) prevents a
// caller from pushing HTML to a site id they don't own. PostgREST applies the
// projects RLS policy, so a row is only returned when the user owns or
// collaborates on the project.
// ---------------------------------------------------------------------------

// Conservative id charset — uuids pass, and it rules out any character that
// could alter the PostgREST filter even before URL-encoding.
const PROJECT_ID_RE = /^[A-Za-z0-9_-]{1,100}$/

export interface ProjectAccess {
  /** True only when the caller may deploy this project. */
  ok: boolean
  /** The project's persisted hosting site name, or null if it has none yet. */
  siteId: string | null
  /** The project's title, used to build a readable subdomain on first deploy. */
  title: string | null
}

export async function getProjectForDeploy(
  authorization: string | undefined,
  projectId: string,
): Promise<ProjectAccess> {
  const env = supabaseEnv()
  const token = bearer(authorization)
  if (!env || !token || !PROJECT_ID_RE.test(projectId)) return { ok: false, siteId: null, title: null }

  try {
    const res = await fetch(
      `${env.url}/rest/v1/projects?id=eq.${encodeURIComponent(projectId)}&select=hosting_site_name,title&limit=1`,
      { headers: { apikey: env.anonKey, Authorization: `Bearer ${token}`, Accept: 'application/json' } },
    )
    if (!res.ok) return { ok: false, siteId: null, title: null }
    const rows = (await res.json()) as Array<{ hosting_site_name?: string | null; title?: string | null }>
    if (!Array.isArray(rows) || rows.length === 0) return { ok: false, siteId: null, title: null }
    const siteId = rows[0]?.hosting_site_name
    const title = rows[0]?.title
    return {
      ok: true,
      siteId: typeof siteId === 'string' && siteId ? siteId : null,
      title: typeof title === 'string' && title ? title : null,
    }
  } catch {
    return { ok: false, siteId: null, title: null }
  }
}

/** Best-effort: persist the hosting site id so future deploys reuse the site. */
export async function persistProjectSiteId(
  authorization: string | undefined,
  projectId: string,
  siteId: string,
): Promise<void> {
  const env = supabaseEnv()
  const token = bearer(authorization)
  if (!env || !token || !PROJECT_ID_RE.test(projectId)) return

  try {
    await fetch(`${env.url}/rest/v1/projects?id=eq.${encodeURIComponent(projectId)}`, {
      method: 'PATCH',
      headers: {
        apikey: env.anonKey,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ hosting_site_name: siteId }),
    })
  } catch {
    /* non-fatal — the client also persists this after a successful deploy */
  }
}

// ---------------------------------------------------------------------------
// Rate limiting — in-memory only (Redis/Upstash REMOVED)
//
// On Vercel, function instances are ephemeral and run concurrently, so an
// in-memory counter cannot enforce a truly global limit. However, for most
// use cases this is sufficient. If you need global rate limiting, consider
// Supabase Edge Functions + pg tables or a free Dragonfly Cloud instance.
// ---------------------------------------------------------------------------

const buckets = new Map<string, number[]>()

function inMemoryRateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now()
  const hits = (buckets.get(key) || []).filter((t) => now - t < windowMs)
  if (hits.length >= max) {
    buckets.set(key, hits)
    return false
  }
  hits.push(now)
  buckets.set(key, hits)
  return true
}

/** Returns true if the action is allowed, false if the caller is over the limit. */
export async function rateLimit(key: string, max: number, windowMs: number): Promise<boolean> {
  return inMemoryRateLimit(key, max, windowMs)
}

// ---------------------------------------------------------------------------
// Server-side provider-key encryption (AES-256-GCM)
//
// The encryption key is derived from a server-held secret (KEY_ENCRYPTION_SECRET)
// combined with the user id. A database dump alone therefore cannot be decrypted
// without also holding the server secret.
// ---------------------------------------------------------------------------

const SERVER_PREFIX = 'senc:'

export function hasEncryptionSecret(): boolean {
  return Boolean(process.env.KEY_ENCRYPTION_SECRET)
}

function deriveServerKey(userId: string): Buffer {
  const secret = process.env.KEY_ENCRYPTION_SECRET
  if (!secret) throw new Error('KEY_ENCRYPTION_SECRET is not configured')
  return Buffer.from(hkdfSync('sha256', secret, userId, 'provider-key-v1', 32))
}

export function encryptForUser(plaintext: string, userId: string): string {
  const key = deriveServerKey(userId)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${SERVER_PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('base64')}`
}

export function decryptForUser(stored: string, userId: string): string {
  if (!stored.startsWith(SERVER_PREFIX)) return stored
  const body = stored.slice(SERVER_PREFIX.length)
  const [ivHex, tagHex, ctB64] = body.split(':')
  if (!ivHex || !tagHex || !ctB64) throw new Error('Malformed encrypted value')
  const key = deriveServerKey(userId)
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  const pt = Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()])
  return pt.toString('utf8')
}

// ---------------------------------------------------------------------------
// Puter.js hosting — NOTE: Deploy is now fully CLIENT-SIDE via the Puter.js
// browser SDK (<script src="https://js.puter.com/v2/"></script>).
//
// There is NO server-side deploy endpoint. The browser calls:
//   puter.fs.write()       → write HTML to Puter filesystem
//   puter.hosting.create() → publish as *.puter.site (first deploy)
//   puter.hosting.update() → re-deploy to existing subdomain
//
// Auth happens automatically via popup when any puter.* API is called.
// No PUTER_API_TOKEN needed on the server.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// E2B Sandbox integration — filesystem & runtime execution
//
// E2B provides cloud sandboxes for secure code execution. This integration
// enables:
// 1. Filesystem operations: read/write files in a remote sandbox
// 2. Command execution: run arbitrary commands (npm, python, etc.) in the sandbox
// 3. Background execution: sandboxes persist even if the user closes their browser
//
// The serverless hand-off architecture works like:
//   [Browser] → POST /api/e2b-sandbox → [Vercel Function] → [E2B Cloud Sandbox]
//   The function returns immediately (202), and the sandbox runs autonomously.
//   Results are stored in Supabase, and push notifications alert the user.
// ---------------------------------------------------------------------------

export interface E2BSandboxConfig {
  apiKey: string
  template?: string // E2B sandbox template ID (default: 'base')
  timeoutMs?: number // Max execution time (default: 300000 = 5 min)
}

export function getE2BConfig(): E2BSandboxConfig | null {
  const apiKey = process.env.E2B_API_KEY
  if (!apiKey) return null
  return {
    apiKey,
    template: process.env.E2B_TEMPLATE || 'base',
    timeoutMs: Number(process.env.E2B_TIMEOUT_MS) || 300_000,
  }
}

export function hasE2BConfig(): boolean {
  return Boolean(process.env.E2B_API_KEY)
}

// ---------------------------------------------------------------------------
// Admin operations (service role)
//
// Used by api/admin.ts and the matching vite dev shim. The service role key
// must never reach the client; these helpers run only server-side. The
// caller's admin status is always re-checked here via the database — the
// client is never trusted.
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isValidUserId(id: string): boolean {
  return UUID_RE.test(id)
}

function serviceRoleKey(): string | null {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || null
}

export function hasServiceRoleKey(): boolean {
  return Boolean(serviceRoleKey())
}

function serviceHeaders(key: string): Record<string, string> {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
}

/** True only when the given user's profile row has is_admin = true. */
export async function isAdminUser(userId: string): Promise<boolean> {
  const env = supabaseEnv()
  const key = serviceRoleKey()
  if (!env || !key || !isValidUserId(userId)) return false
  try {
    const res = await fetch(
      `${env.url}/rest/v1/profiles?id=eq.${userId}&select=is_admin&limit=1`,
      { headers: { ...serviceHeaders(key), Accept: 'application/json' } },
    )
    if (!res.ok) return false
    const rows = (await res.json()) as Array<{ is_admin?: boolean }>
    return Boolean(rows?.[0]?.is_admin)
  } catch {
    return false
  }
}

/** Ban or unban a user at the auth level and mirror the flag on profiles. */
export async function adminSetUserSuspended(userId: string, suspended: boolean): Promise<void> {
  const env = supabaseEnv()
  const key = serviceRoleKey()
  if (!env || !key) throw new Error('Service role not configured')
  if (!isValidUserId(userId)) throw new Error('Invalid user id')

  const res = await fetch(`${env.url}/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    headers: serviceHeaders(key),
    // "none" lifts the ban; 876000h ≈ 100 years.
    body: JSON.stringify({ ban_duration: suspended ? '876000h' : 'none' }),
  })
  if (!res.ok) throw new Error(`Auth admin error ${res.status}`)

  const mirror = await fetch(`${env.url}/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: { ...serviceHeaders(key), Prefer: 'return=minimal' },
    body: JSON.stringify({ suspended }),
  })
  if (!mirror.ok) throw new Error(`Profile update error ${mirror.status}`)
}

/** True when a Vercel deploy hook is configured. */
export function hasDeployHook(): boolean {
  return Boolean(process.env.VERCEL_DEPLOY_HOOK_URL)
}

/** Fire the Vercel deploy hook to regenerate the prerendered site. */
export async function triggerDeploy(): Promise<void> {
  const hook = process.env.VERCEL_DEPLOY_HOOK_URL
  if (!hook) throw new Error('Deploy hook not configured')
  const res = await fetch(hook, { method: 'POST' })
  if (!res.ok) throw new Error(`Deploy hook error ${res.status}`)
}

/** Insert a dashboard bell notification for all signed-in users. */
export async function adminCreateNotification(text: string, timeLabel = 'New'): Promise<void> {
  const env = supabaseEnv()
  const key = serviceRoleKey()
  const cleanText = text.trim()
  const cleanTimeLabel = timeLabel.trim() || 'New'
  if (!env || !key) throw new Error('Service role not configured')
  if (!cleanText) throw new Error('Message is required')

  const res = await fetch(`${env.url}/rest/v1/notifications`, {
    method: 'POST',
    headers: { ...serviceHeaders(key), Prefer: 'return=minimal' },
    body: JSON.stringify({ text: cleanText, time_label: cleanTimeLabel, is_active: true }),
  })
  if (!res.ok) throw new Error(`Notification insert error ${res.status}`)
}

/** Permanently delete a user. The profiles row cascades via its FK. */
export async function adminDeleteUser(userId: string): Promise<void> {
  const env = supabaseEnv()
  const key = serviceRoleKey()
  if (!env || !key) throw new Error('Service role not configured')
  if (!isValidUserId(userId)) throw new Error('Invalid user id')

  const res = await fetch(`${env.url}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: serviceHeaders(key),
  })
  if (!res.ok) throw new Error(`Auth admin error ${res.status}`)
}

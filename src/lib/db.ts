import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  prismaSetupDone?: boolean
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['error', 'warn'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

/**
 * Ensure the SQLite schema is in sync on cold starts (Vercel serverless).
 *
 * On Vercel, the SQLite file lives in /tmp which is ephemeral — each cold
 * start gets a fresh filesystem. The Prisma client can't query tables that
 * don't exist yet, so we trigger a `db push` programmatically on the first
 * DB access. This is a no-op if the schema is already in sync (Prisma
 * compares the local schema to the file's _prisma_migrations table).
 *
 * This is the SQLite-only fallback. For production persistence, set
 * DATABASE_URL to a real Postgres connection string (Neon, Vercel Postgres).
 */
export async function ensureDbSchema(): Promise<void> {
  if (globalForPrisma.prismaSetupDone) return
  globalForPrisma.prismaSetupDone = true
  try {
    const url = process.env.DATABASE_URL ?? ''
    // Only run for SQLite file: URLs (skip for postgres://)
    if (url.startsWith('file:')) {
      const { execSync } = await import('node:child_process')
      const isProd = process.env.NODE_ENV === 'production'
      if (isProd) {
        // On Vercel, the prisma CLI is in node_modules — use it to push schema.
        try {
          execSync('npx prisma db push --skip-generate --accept-data-loss', {
            stdio: 'ignore',
            timeout: 30000,
            cwd: process.cwd(),
          })
        } catch {
          // If npx isn't available or push fails, fall through — Prisma
          // will throw on the first query, which the caller must handle.
        }
      }
    }
  } catch {
    // Best-effort — fail silently. Callers should catch their own errors.
  }
}

/** Wrap a Prisma operation in try/catch + schema setup. Returns null on failure. */
export async function withDb<T>(
  fn: (db: PrismaClient) => Promise<T>,
): Promise<T | null> {
  try {
    await ensureDbSchema()
    return await fn(db)
  } catch (err) {
    // Schema mismatch or DB error — return null so callers can degrade
    // gracefully (serve empty cache, mark provider as degraded, etc.).
    if (process.env.NODE_ENV !== 'production') {
      console.error('[withDb] error:', err instanceof Error ? err.message : String(err))
    }
    return null
  }
}

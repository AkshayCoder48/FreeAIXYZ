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
 * SQLite schema setup statements — keep in sync with prisma/schema.prisma.
 * Used to provision a fresh /tmp/freeaixyz-prod.db on Vercel cold starts.
 * For production persistence, set DATABASE_URL to a real Postgres URL.
 */
const SQLITE_DDL = [
  `CREATE TABLE IF NOT EXISTS User (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    displayName TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    lastLoginAt DATETIME
  )`,
  `CREATE TABLE IF NOT EXISTS EmailCode (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    email TEXT NOT NULL,
    codeHash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    consumed BOOLEAN NOT NULL DEFAULT 0,
    expiresAt DATETIME NOT NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ip TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_emailcode_userid ON EmailCode(userId)`,
  `CREATE INDEX IF NOT EXISTS idx_emailcode_email ON EmailCode(email)`,
  `CREATE INDEX IF NOT EXISTS idx_emailcode_expires ON EmailCode(expiresAt)`,
  `CREATE TABLE IF NOT EXISTS Session (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    tokenHash TEXT NOT NULL UNIQUE,
    csrfHash TEXT,
    userAgent TEXT,
    ip TEXT,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    lastSeenAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expiresAt DATETIME NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_session_userid ON Session(userId)`,
  `CREATE INDEX IF NOT EXISTS idx_session_expires ON Session(expiresAt)`,
  `CREATE TABLE IF NOT EXISTS ApiKey (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    keyHash TEXT NOT NULL UNIQUE,
    keyPrefix TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT 'default',
    scopes TEXT NOT NULL DEFAULT 'chat,models',
    lastUsedAt DATETIME,
    revokedAt DATETIME,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_apikey_userid ON ApiKey(userId)`,
  `CREATE TABLE IF NOT EXISTS ByokCredential (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    provider TEXT NOT NULL,
    encryptedKey TEXT NOT NULL,
    keyIv TEXT NOT NULL,
    keyTag TEXT NOT NULL,
    keyPrefix TEXT NOT NULL,
    keySuffix TEXT NOT NULL,
    validatedAt DATETIME,
    validationError TEXT,
    lastUsedAt DATETIME,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_byok_user_provider ON ByokCredential(userId, provider)`,
  `CREATE INDEX IF NOT EXISTS idx_byok_provider ON ByokCredential(provider)`,
  `CREATE TABLE IF NOT EXISTS XyzAccount (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL UNIQUE,
    balanceMicro BIGINT NOT NULL DEFAULT 0,
    lastDailyGrantAt DATETIME,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS XyzTransaction (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    type TEXT NOT NULL,
    amountMicro BIGINT NOT NULL,
    balanceAfterMicro BIGINT NOT NULL,
    modelId TEXT,
    providerId TEXT,
    requestId TEXT,
    usageRecordId TEXT,
    description TEXT,
    metadata TEXT,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_xyztx_userid ON XyzTransaction(userId)`,
  `CREATE INDEX IF NOT EXISTS idx_xyztx_created ON XyzTransaction(createdAt)`,
  `CREATE INDEX IF NOT EXISTS idx_xyztx_type ON XyzTransaction(type)`,
  `CREATE TABLE IF NOT EXISTS XyzReservation (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    requestId TEXT NOT NULL,
    modelId TEXT NOT NULL,
    reservedMicro BIGINT NOT NULL,
    status TEXT NOT NULL DEFAULT 'held',
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    settledAt DATETIME,
    releasedAt DATETIME
  )`,
  `CREATE INDEX IF NOT EXISTS idx_xyzres_userid ON XyzReservation(userId)`,
  `CREATE INDEX IF NOT EXISTS idx_xyzres_status ON XyzReservation(status)`,
  `CREATE TABLE IF NOT EXISTS UsageRecord (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    requestId TEXT NOT NULL UNIQUE,
    modelId TEXT NOT NULL,
    providerId TEXT NOT NULL,
    source TEXT NOT NULL,
    inputTokens INTEGER NOT NULL DEFAULT 0,
    outputTokens INTEGER NOT NULL DEFAULT 0,
    cacheTokens INTEGER NOT NULL DEFAULT 0,
    usdCost REAL NOT NULL DEFAULT 0,
    xyzCostMicro BIGINT NOT NULL DEFAULT 0,
    streamRequested BOOLEAN NOT NULL DEFAULT 0,
    success BOOLEAN NOT NULL DEFAULT 1,
    errorCode TEXT,
    errorMessage TEXT,
    durationMs INTEGER,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_usage_userid ON UsageRecord(userId)`,
  `CREATE INDEX IF NOT EXISTS idx_usage_model ON UsageRecord(modelId)`,
  `CREATE INDEX IF NOT EXISTS idx_usage_provider ON UsageRecord(providerId)`,
  `CREATE INDEX IF NOT EXISTS idx_usage_created ON UsageRecord(createdAt)`,
  `CREATE TABLE IF NOT EXISTS Provider (
    id TEXT PRIMARY KEY,
    shortId TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'native',
    baseUrl TEXT,
    docsUrl TEXT,
    status TEXT NOT NULL DEFAULT 'unknown',
    requiresApiKey BOOLEAN NOT NULL DEFAULT 0,
    discoveryMode TEXT NOT NULL DEFAULT 'manual',
    lastFetchedAt DATETIME,
    lastHealthAt DATETIME,
    latencyMs INTEGER,
    successRate REAL,
    errorRate REAL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_provider_status ON Provider(status)`,
  `CREATE INDEX IF NOT EXISTS idx_provider_type ON Provider(type)`,
  `CREATE TABLE IF NOT EXISTS ProviderModel (
    id TEXT PRIMARY KEY,
    providerId TEXT NOT NULL,
    upstreamId TEXT NOT NULL,
    publicId TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    capabilities TEXT NOT NULL DEFAULT '[]',
    contextLength INTEGER,
    modality TEXT,
    status TEXT NOT NULL DEFAULT 'available',
    active BOOLEAN NOT NULL DEFAULT 1,
    discoveryMode TEXT NOT NULL DEFAULT 'manual',
    firstSeenAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    lastSeenAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    lastVerifiedAt DATETIME,
    rawMetadata TEXT,
    FOREIGN KEY (providerId) REFERENCES Provider(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_pmodel_provider ON ProviderModel(providerId)`,
  `CREATE INDEX IF NOT EXISTS idx_pmodel_upstream ON ProviderModel(upstreamId)`,
  `CREATE INDEX IF NOT EXISTS idx_pmodel_status ON ProviderModel(status)`,
  `CREATE INDEX IF NOT EXISTS idx_pmodel_active ON ProviderModel(active)`,
  `CREATE TABLE IF NOT EXISTS ProviderFetchRun (
    id TEXT PRIMARY KEY,
    providerId TEXT,
    source TEXT NOT NULL,
    startedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finishedAt DATETIME,
    success BOOLEAN,
    modelsFound INTEGER NOT NULL DEFAULT 0,
    modelsAdded INTEGER NOT NULL DEFAULT 0,
    modelsDeactivated INTEGER NOT NULL DEFAULT 0,
    errorCode TEXT,
    errorMessage TEXT,
    durationMs INTEGER,
    FOREIGN KEY (providerId) REFERENCES Provider(id) ON DELETE SET NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_fetchrun_provider ON ProviderFetchRun(providerId)`,
  `CREATE INDEX IF NOT EXISTS idx_fetchrun_started ON ProviderFetchRun(startedAt)`,
  `CREATE TABLE IF NOT EXISTS ModelHealth (
    id TEXT PRIMARY KEY,
    modelId TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'unknown',
    failureCount INTEGER NOT NULL DEFAULT 0,
    successCount INTEGER NOT NULL DEFAULT 0,
    lastFailure DATETIME,
    lastSuccess DATETIME,
    lastChecked DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    latencyMs INTEGER,
    lastError TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_health_status ON ModelHealth(status)`,
  `CREATE TABLE IF NOT EXISTS ModelPricing (
    id TEXT PRIMARY KEY,
    modelId TEXT NOT NULL,
    publicModelId TEXT NOT NULL,
    providerId TEXT NOT NULL,
    inputPerMillion REAL,
    outputPerMillion REAL,
    cachePerMillion REAL,
    source TEXT NOT NULL DEFAULT 'undocumented',
    notes TEXT,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (providerId) REFERENCES Provider(id) ON DELETE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_pricing_model_provider ON ModelPricing(publicModelId, providerId)`,
  `CREATE INDEX IF NOT EXISTS idx_pricing_public ON ModelPricing(publicModelId)`,
  `CREATE INDEX IF NOT EXISTS idx_pricing_source ON ModelPricing(source)`,
  `CREATE INDEX IF NOT EXISTS idx_pricing_provider ON ModelPricing(providerId)`,
  `CREATE TABLE IF NOT EXISTS PlaygroundSession (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT 'Untitled',
    modelId TEXT,
    messages TEXT NOT NULL DEFAULT '[]',
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_playground_userid ON PlaygroundSession(userId)`,
  `CREATE INDEX IF NOT EXISTS idx_playground_updated ON PlaygroundSession(updatedAt)`,
  `CREATE TABLE IF NOT EXISTS AuditEvent (
    id TEXT PRIMARY KEY,
    userId TEXT,
    action TEXT NOT NULL,
    detail TEXT,
    source TEXT,
    ip TEXT,
    requestId TEXT,
    metadata TEXT,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (userId) REFERENCES User(id) ON DELETE SET NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_audit_user ON AuditEvent(userId)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_action ON AuditEvent(action)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_created ON AuditEvent(createdAt)`,
]

/**
 * Ensure the SQLite schema is in sync on cold starts (Vercel serverless).
 *
 * For SQLite file: URLs, runs the DDL statements above. This is fast
 * (~50-100ms) and doesn't require the Prisma CLI at runtime.
 *
 * For postgres URLs, this is a no-op (assume the schema is managed via
 * migrations outside the runtime).
 */
export async function ensureDbSchema(): Promise<void> {
  if (globalForPrisma.prismaSetupDone) return
  globalForPrisma.prismaSetupDone = true
  const url = process.env.DATABASE_URL ?? ''
  if (!url.startsWith('file:')) return // Postgres — assume schema is managed externally
  try {
    for (const ddl of SQLITE_DDL) {
      try {
        await db.$executeRawUnsafe(ddl)
      } catch {
        // Individual statement may fail if table already exists with
        // different column types — ignore and continue.
      }
    }
  } catch {
    // Best-effort — fail silently.
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
    if (process.env.NODE_ENV !== 'production') {
      console.error('[withDb] error:', err instanceof Error ? err.message : String(err))
    }
    return null
  }
}

/**
 * XYZ Credit System (PRD §39–48).
 *
 * Backed by Prisma. XYZ is a normalized usage credit (NOT "one request").
 * Cost is derived from the central pricing board × actual token usage
 * (PRD §22, §31, §32):
 *
 *   usdCost  = (input/1e6)*in  + (output/1e6)*out  + (cache/1e6)*cache
 *   xyzCost  = usdCost * XYZ_USD_MULTIPLIER
 *
 * Daily grant: +1 XYZ/day per eligible account, server-side, idempotent
 * (PRD §39, §46). Atomic balance spending via Prisma transactions
 * (PRD §45). Decimal-safe arithmetic — balance + ledger amounts are stored
 * as integer MICRO-XYZ (1 XYZ = 1_000_000 micro) to avoid float drift.
 *
 * BYOK (PRD §48): platformXYZCost = 0 by default; marketEquivalentCost
 * recorded for display only — the upstream provider bills the user's own
 * key directly.
 */

import { db } from "@/lib/db";
import {
  XYZ_USD_MULTIPLIER,
  POLLEN_XYZ_PEG,
  REFERENCE_REQUEST,
  resolveSuppliedPricing,
  PRICING_BOARD_VERSION,
} from "./pricing-board";
import type {
  ModelPricing,
  UsageRecord,
  XYZBalance,
  XYZTransaction,
  XYZTransactionType,
  Source,
} from "./types";

// ─── Decimal-safe arithmetic (PRD §44) ──────────────────────────────────────
// All persisted monetary values are integer MICRO-units (1 unit = 1e-6 of the
// base currency). USD is also tracked in micro-USD to avoid float drift in
// cost accumulation. Conversion to human decimals happens only at the
// presentation boundary.
const XYZ_SCALE = 1_000_000; // 1 XYZ = 1,000,000 micro-XYZ
const USD_SCALE = 1_000_000; // 1 USD = 1,000,000 micro-USD

function toMicroXyz(xyz: number): bigint {
  // Use BigInt arithmetic for atomic precision (Prisma BigInt column).
  return BigInt(Math.round(xyz * XYZ_SCALE));
}
function fromMicroXyz(m: bigint): number {
  return Number(m) / XYZ_SCALE;
}
function toMicroUsd(usd: number): bigint {
  return BigInt(Math.round(usd * USD_SCALE));
}
function fromMicroUsd(m: bigint): number {
  return Number(m) / USD_SCALE;
}

// ─── Cost calculation (PRD §31, §32) ─────────────────────────────────────────

export interface CostBreakdown {
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  usdCost: number;
  xyzCost: number;
  pricingVersion: number;
  estimated: boolean;
  pricing: ModelPricing;
}

/**
 * Calculate the USD + XYZ cost of a generation from token usage + the pricing
 * board. Centralized here so no provider adapter invents its own math
 * (PRD §23, §32).
 *
 * CURRENCY-AWARE (user directive: "1 pollen = 1 XYZ"):
 *   - When `pricing.currency === "pollen"` (Gratisfy catalog / Pollinations
 *     metadata), the per-million numbers are POLLEN, not USD. We never present
 *     pollen as USD (PRD §26). Instead:
 *       pollenCost = (in/1e6)*inputPollen + (out/1e6)*outputPollen + ...
 *       xyzCost   = pollenCost * POLLEN_XYZ_PEG   (1:1 by default)
 *       usdCost   = 0   (pollen is not USD; the USD figure is intentionally
 *     left at 0 so the ledger never falsely claims a USD market value for
 *     pollen-denominated usage).
 *   - When `pricing.currency === "USD"`, the existing path applies:
 *       usdCost  = (in/1e6)*inputUsd + ...
 *       xyzCost  = usdCost * XYZ_USD_MULTIPLIER
 */
export function calculateCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  cacheTokens = 0,
  pricingOverride?: ModelPricing,
): CostBreakdown {
  const pricing = pricingOverride ?? resolveSuppliedPricing(modelId);

  // Not documented → cannot charge. Record usage but cost is 0/unknown.
  if (pricing.status === "not_documented" || pricing.inputPerMillion == null) {
    return {
      inputTokens,
      outputTokens,
      cacheTokens,
      usdCost: 0,
      xyzCost: 0,
      pricingVersion: PRICING_BOARD_VERSION,
      estimated: false,
      pricing,
    };
  }

  // POLLEN currency path (user directive: 1 pollen = 1 XYZ).
  // Per-million numbers are pollen; we charge XYZ at the configured peg
  // (default 1:1). usdCost stays 0 — pollen is not USD (PRD §26).
  if (pricing.currency === "pollen") {
    const inPollen = (inputTokens / 1_000_000) * pricing.inputPerMillion;
    const outPollen = (outputTokens / 1_000_000) * (pricing.outputPerMillion ?? 0);
    const cachePollen = (cacheTokens / 1_000_000) * (pricing.cachePerMillion ?? 0);
    const pollenCost = fromMicroXyz(
      toMicroXyz(inPollen) + toMicroXyz(outPollen) + toMicroXyz(cachePollen),
    );
    const xyzCost = fromMicroXyz(toMicroXyz(pollenCost) * BigInt(POLLEN_XYZ_PEG));
    return {
      inputTokens,
      outputTokens,
      cacheTokens,
      usdCost: 0,
      xyzCost,
      pricingVersion: PRICING_BOARD_VERSION,
      estimated: false,
      pricing,
    };
  }

  // USD currency path (default).
  const inUsd = (inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outUsd = (outputTokens / 1_000_000) * (pricing.outputPerMillion ?? 0);
  const cacheUsd = (cacheTokens / 1_000_000) * (pricing.cachePerMillion ?? 0);

  const usdCost = fromMicroUsd(
    toMicroUsd(inUsd) + toMicroUsd(outUsd) + toMicroUsd(cacheUsd),
  );
  const xyzCost = fromMicroXyz(toMicroUsd(usdCost) * BigInt(XYZ_USD_MULTIPLIER));

  return {
    inputTokens,
    outputTokens,
    cacheTokens,
    usdCost,
    xyzCost,
    pricingVersion: PRICING_BOARD_VERSION,
    estimated: false,
    pricing,
  };
}

/**
 * Estimate responses-per-XYZ for a model (PRD §41), using a configurable
 * reference request. Labeled "Estimated" because actual counts vary with
 * input/output length, cache, system prompt, etc.
 *
 * Reference request: 1000 input tokens, 1000 output tokens, 0 cache tokens
 * (PRD §41 — Standard Response Estimate).
 */
export function estimateResponsesPerXYZ(
  modelId: string,
  pricingOverride?: ModelPricing,
): { perXyz: number; referenceUsdCost: number; estimated: true } | null {
  const breakdown = calculateCost(
    modelId,
    REFERENCE_REQUEST.inputTokens,
    REFERENCE_REQUEST.outputTokens,
    0,
    pricingOverride,
  );
  if (breakdown.xyzCost <= 0) {
    return { perXyz: Infinity, referenceUsdCost: breakdown.usdCost, estimated: true };
  }
  return {
    perXyz: 1 / breakdown.xyzCost,
    referenceUsdCost: breakdown.usdCost,
    estimated: true,
  };
}

// ─── Balance + ledger persistence via Prisma (PRD §43–46) ────────────────────

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function genId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
}

/** Get or initialize the user's XYZ account. */
export async function getBalance(userId: string): Promise<XYZBalance> {
  let account = await db.xyzAccount.findUnique({ where: { userId } });
  if (!account) {
    account = await db.xyzAccount.create({
      data: { userId, balanceMicro: 0n, lastDailyGrantAt: null },
    });
  }
  return {
    userId,
    xyzBalance: fromMicroXyz(account.balanceMicro),
    lifetimeEarned: 0, // computed from ledger if needed
    lifetimeSpent: 0, // computed from ledger if needed
    lastDailyGrantAt: account.lastDailyGrantAt?.toISOString().slice(0, 10),
    updatedAt: account.updatedAt.toISOString(),
  };
}

/**
 * Daily +1 XYZ grant (PRD §39, §46). Idempotent per (userId, UTC-date):
 * `lastDailyGrantAt` on the account row is the marker. Prisma's atomic
 * update + the conditional check make this safe under concurrency.
 *
 * Implementation: read account; if lastDailyGrantAt === today, return early.
 * Otherwise run an interactive transaction that re-checks the marker (in
 * case another request won the race), then updates balance + inserts a
 * ledger row.
 */
export async function grantDailyXYZ(
  userId: string,
  amount = 1,
): Promise<{ balance: XYZBalance; granted: boolean }> {
  const today = todayUTC();
  const account = await db.xyzAccount.findUnique({ where: { userId } });
  if (!account) {
    await db.xyzAccount.create({
      data: { userId, balanceMicro: 0n, lastDailyGrantAt: null },
    });
    return grantDailyXYZ(userId, amount);
  }
  const lastGrant = account.lastDailyGrantAt?.toISOString().slice(0, 10);
  if (lastGrant === today) {
    return { balance: await getBalance(userId), granted: false };
  }

  // Interactive transaction with re-check — defends against concurrent grants.
  const granted = await db.$transaction(async (tx) => {
    const fresh = await tx.xyzAccount.findUnique({ where: { userId } });
    if (!fresh) return false;
    const freshLastGrant = fresh.lastDailyGrantAt?.toISOString().slice(0, 10);
    if (freshLastGrant === today) return false;

    const amountMicro = toMicroXyz(amount);
    await tx.xyzAccount.update({
      where: { userId },
      data: {
        balanceMicro: { increment: amountMicro },
        lastDailyGrantAt: new Date(),
      },
    });
    await tx.xyzTransaction.create({
      data: {
        userId,
        type: "DAILY_GRANT",
        amountMicro,
        balanceAfterMicro: fresh.balanceMicro + amountMicro,
        description: `Daily grant ${today}`,
        metadata: JSON.stringify({ date: today, amount }),
      },
    });
    return true;
  });

  return { balance: await getBalance(userId), granted };
}

/**
 * Atomic XYZ spend for a generation (PRD §45). Returns ok=false if
 * insufficient balance. Backed by Prisma interactive transaction so two
 * simultaneous requests cannot double-spend the same XYZ.
 */
export async function spendXYZ(
  userId: string,
  cost: number,
  meta: {
    requestId: string;
    source?: Source;
    provider?: string;
    model?: string;
    pricingVersion?: number;
    inputTokens?: number;
    outputTokens?: number;
    cacheTokens?: number;
    usdCost?: number;
    marketEquivalentCost?: number;
    note?: string;
  },
): Promise<{ ok: boolean; balance: XYZBalance; transaction?: XYZTransaction }> {
  const costMicro = toMicroXyz(cost);

  // Free / BYOK-platform-charge-disabled: still record usage at 0 cost.
  if (cost <= 0) {
    const account = await ensureAccount(userId);
    await db.$transaction(async (tx) => {
      await tx.xyzTransaction.create({
        data: {
          userId,
          type: "GENERATION_CHARGE",
          amountMicro: 0n,
          balanceAfterMicro: account.balanceMicro,
          modelId: meta.model ?? null,
          providerId: meta.provider ?? null,
          requestId: meta.requestId,
          description: meta.note ?? "Free / 0-cost generation",
          metadata: JSON.stringify({
            ...meta,
            marketEquivalentCost: meta.marketEquivalentCost,
          }),
        },
      });
      await tx.usageRecord.create({
        data: {
          userId,
          requestId: meta.requestId,
          modelId: meta.model ?? "unknown",
          providerId: meta.provider ?? "unknown",
          source: meta.source ?? "native",
          inputTokens: meta.inputTokens ?? 0,
          outputTokens: meta.outputTokens ?? 0,
          cacheTokens: meta.cacheTokens ?? 0,
          usdCost: meta.usdCost ?? 0,
          xyzCostMicro: 0n,
          streamRequested: false,
          success: true,
        },
      });
    });
    const balance = await getBalance(userId);
    return {
      ok: true,
      balance,
      transaction: {
        id: genId("tx"),
        userId,
        type: "GENERATION_CHARGE",
        amount: 0,
        balanceAfter: balance.xyzBalance,
        ...meta,
        createdAt: new Date().toISOString(),
      },
    };
  }

  // Charged generation — atomic balance check + decrement.
  const result = await db.$transaction(async (tx) => {
    const account = await tx.xyzAccount.findUnique({ where: { userId } });
    if (!account) return { ok: false as const, balanceMicro: 0n };
    if (account.balanceMicro < costMicro) {
      return { ok: false as const, balanceMicro: account.balanceMicro };
    }
    const newBalance = account.balanceMicro - costMicro;
    await tx.xyzAccount.update({
      where: { userId },
      data: { balanceMicro: newBalance },
    });
    await tx.xyzTransaction.create({
      data: {
        userId,
        type: "GENERATION_CHARGE",
        amountMicro: -costMicro,
        balanceAfterMicro: newBalance,
        modelId: meta.model ?? null,
        providerId: meta.provider ?? null,
        requestId: meta.requestId,
        description: meta.note ?? "Generation charge",
        metadata: JSON.stringify({
          ...meta,
          marketEquivalentCost: meta.marketEquivalentCost,
        }),
      },
    });
    await tx.usageRecord.create({
      data: {
        userId,
        requestId: meta.requestId,
        modelId: meta.model ?? "unknown",
        providerId: meta.provider ?? "unknown",
        source: meta.source ?? "native",
        inputTokens: meta.inputTokens ?? 0,
        outputTokens: meta.outputTokens ?? 0,
        cacheTokens: meta.cacheTokens ?? 0,
        usdCost: meta.usdCost ?? 0,
        xyzCostMicro: costMicro,
        streamRequested: false,
        success: true,
      },
    });
    return { ok: true as const, balanceMicro: newBalance };
  });

  const balance = await getBalance(userId);
  if (!result.ok) {
    return { ok: false, balance };
  }
  return {
    ok: true,
    balance,
    transaction: {
      id: genId("tx"),
      userId,
      type: "GENERATION_CHARGE",
      amount: -cost,
      balanceAfter: balance.xyzBalance,
      ...meta,
      createdAt: new Date().toISOString(),
    },
  };
}

/** Refund a generation (PRD §41, §42, §43). */
export async function refundXYZ(
  userId: string,
  amount: number,
  requestId: string,
  note?: string,
): Promise<XYZBalance> {
  if (amount <= 0) return getBalance(userId);
  const amountMicro = toMicroXyz(amount);
  await db.$transaction(async (tx) => {
    const account = await tx.xyzAccount.findUnique({ where: { userId } });
    if (!account) return;
    const newBalance = account.balanceMicro + amountMicro;
    await tx.xyzAccount.update({
      where: { userId },
      data: { balanceMicro: newBalance },
    });
    await tx.xyzTransaction.create({
      data: {
        userId,
        type: "REFUND",
        amountMicro,
        balanceAfterMicro: newBalance,
        requestId,
        description: note ?? "Refund (failed/partial generation)",
      },
    });
  });
  return getBalance(userId);
}

/** Mark a usage record as failed (post-settle). Records the error but does
 * NOT refund (refund is a separate explicit call). */
export async function recordGenerationFailure(
  userId: string,
  requestId: string,
  errorCode: string,
  errorMessage: string,
): Promise<void> {
  await db.usageRecord.updateMany({
    where: { requestId },
    data: { success: false, errorCode, errorMessage },
  });
}

export async function getTransactions(
  userId: string,
  limit = 50,
): Promise<XYZTransaction[]> {
  const rows = await db.xyzTransaction.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map((r) => ({
    id: r.id,
    userId,
    type: r.type as XYZTransactionType,
    amount: fromMicroXyz(r.amountMicro),
    balanceAfter: fromMicroXyz(r.balanceAfterMicro),
    requestId: r.requestId ?? undefined,
    provider: r.providerId ?? undefined,
    model: r.modelId ?? undefined,
    note: r.description ?? undefined,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function getUsage(
  userId: string,
  limit = 50,
): Promise<UsageRecord[]> {
  const rows = await db.usageRecord.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map((r) => ({
    requestId: r.requestId,
    userId,
    source: r.source as Source,
    provider: r.providerId,
    model: r.modelId,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    cacheTokens: r.cacheTokens,
    usdCost: r.usdCost,
    xyzCost: fromMicroXyz(r.xyzCostMicro),
    pricingVersion: PRICING_BOARD_VERSION,
    timestamp: r.createdAt.toISOString(),
  }));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function ensureAccount(userId: string) {
  const account = await db.xyzAccount.findUnique({ where: { userId } });
  if (account) return account;
  return db.xyzAccount.create({
    data: { userId, balanceMicro: 0n, lastDailyGrantAt: null },
  });
}

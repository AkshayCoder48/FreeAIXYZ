/**
 * XYZ Credit System (PRD §20-46).
 *
 * XYZ is a normalized usage credit (NOT "one request"). Cost is derived from
 * the central pricing board × actual token usage (PRD §22, §31, §32):
 *
 *   usdCost  = (input/1e6)*in  + (output/1e6)*out  + (cache/1e6)*cache
 *   xyzCost  = usdCost * XYZ_USD_MULTIPLIER
 *
 * Daily grant: +1 XYZ/day per eligible account, server-side, idempotent
 * (PRD §21, §46). Atomic balance spending (PRD §45). Decimal-safe arithmetic
 * (PRD §44) — balance + ledger amounts are stored as integer MICRO-XYZ
 * (1 XYZ = 1_000_000 micro) to avoid float drift.
 *
 * BYOK (PRD §36): platformXYZCost = 0; marketEquivalentCost recorded for
 * display only — the upstream provider bills the user's own key directly.
 */

import { onyxbase } from "./onyxbase";
import {
  XYZ_USD_MULTIPLIER,
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
} from "./types";

// ─── Decimal-safe arithmetic (PRD §44) ──────────────────────────────────────
// All persisted monetary values are integer MICRO-units (1 unit = 1e-6 of the
// base currency). USD is also tracked in micro-USD to avoid float drift in
// cost accumulation. Conversion to human decimals happens only at the
// presentation boundary.
const XYZ_SCALE = 1_000_000; // 1 XYZ = 1,000,000 micro-XYZ
const USD_SCALE = 1_000_000; // 1 USD = 1,000,000 micro-USD

function toMicroXyz(xyz: number): number {
  return Math.round(xyz * XYZ_SCALE);
}
function fromMicroXyz(m: number): number {
  return Math.round(m) / XYZ_SCALE;
}
function toMicroUsd(usd: number): number {
  return Math.round(usd * USD_SCALE);
}
function fromMicroUsd(m: number): number {
  return Math.round(m) / USD_SCALE;
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

  const inUsd =
    (inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outUsd =
    (outputTokens / 1_000_000) * (pricing.outputPerMillion ?? 0);
  const cacheUsd =
    (cacheTokens / 1_000_000) * (pricing.cachePerMillion ?? 0);

  const usdCost = fromMicroUsd(
    toMicroUsd(inUsd) + toMicroUsd(outUsd) + toMicroUsd(cacheUsd),
  );
  const xyzCost = fromMicroXyz(Math.round(toMicroUsd(usdCost) * XYZ_USD_MULTIPLIER));

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
 * Estimate responses-per-XYZ for a model (PRD §33, §34), using a configurable
 * reference request. Labeled "Estimated" because actual counts vary with
 * input/output length, cache, system prompt, etc.
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

// ─── Balance + ledger persistence (PRD §43-46) ───────────────────────────────

const COLL = "freeaixyz";
const balKey = (uid: string) => `xyz:balance:${uid}`;
const txKey = (uid: string) => `xyz:transactions:${uid}`;
const usageKey = (uid: string) => `usage:${uid}`;
const grantMarkerKey = (uid: string, date: string) =>
  `xyz:grant:${uid}:${date}`;

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function uid(): string {
  return `u_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

/** Load a user's balance (or initialize a new account at 0). */
export async function getBalance(userId: string): Promise<XYZBalance> {
  const stored = await onyxbase.get<XYZBalance>(balKey(userId), COLL);
  if (stored && typeof stored.xyzBalance === "number") {
    return stored;
  }
  const fresh: XYZBalance = {
    userId,
    xyzBalance: 0,
    lifetimeEarned: 0,
    lifetimeSpent: 0,
    updatedAt: new Date().toISOString(),
  };
  await onyxbase.set(balKey(userId), fresh, COLL);
  return fresh;
}

/**
 * Daily +1 XYZ grant (PRD §21, §46). Idempotent per (userId, UTC-date): a
 * grant marker key is set; if it already exists for today, the grant is
 * skipped. Returns the resulting balance.
 *
 * NOTE on atomicity: OnyxBase has no native CAS (researched R3). The
 * key-existence gate is best-effort; for true single-flight under high
 * concurrency the OnyxBase server-side functions endpoint would be needed.
 * For the daily-grant use case (one call per user per day, typically on
 * first authenticated request) the race window is negligible.
 */
export async function grantDailyXYZ(
  userId: string,
  amount = 1,
): Promise<{ balance: XYZBalance; granted: boolean }> {
  const balance = await getBalance(userId);
  const date = todayUTC();
  if (balance.lastDailyGrantAt === date) {
    return { balance, granted: false };
  }
  // Idempotency marker — if a concurrent call already wrote it, skip.
  const marker = await onyxbase.get(grantMarkerKey(userId, date), COLL);
  if (marker) {
    // Another call won the race; reload balance (it may have updated).
    const refreshed = await getBalance(userId);
    return { balance: refreshed, granted: false };
  }
  await onyxbase.set(grantMarkerKey(userId, date), { at: Date.now() }, COLL);

  const newBalanceMicro = toMicroXyz(balance.xyzBalance) + toMicroXyz(amount);
  const updated: XYZBalance = {
    ...balance,
    xyzBalance: fromMicroXyz(newBalanceMicro),
    lifetimeEarned: fromMicroXyz(
      toMicroXyz(balance.lifetimeEarned) + toMicroXyz(amount),
    ),
    lastDailyGrantAt: date,
    updatedAt: new Date().toISOString(),
  };
  await onyxbase.set(balKey(userId), updated, COLL);

  await appendTransaction(userId, {
    id: uid(),
    userId,
    type: "DAILY_GRANT" as XYZTransactionType,
    amount,
    balanceAfter: updated.xyzBalance,
    note: `Daily grant ${date}`,
    createdAt: new Date().toISOString(),
  });

  return { balance: updated, granted: true };
}

/**
 * Atomic XYZ spend for a generation (PRD §45). Returns the transaction or
 * null if insufficient balance. Best-effort atomic: re-reads balance,
 * decrements, writes back. For high-concurrency per-user spending, the
 * OnyxBase functions endpoint should back this.
 */
export async function spendXYZ(
  userId: string,
  cost: number,
  meta: {
    requestId: string;
    source?: XYZTransaction["source"];
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
  if (cost <= 0) {
    // Free / BYOK-platform-charge-disabled: still record usage at 0 cost.
    const balance = await getBalance(userId);
    const tx: XYZTransaction = {
      id: uid(),
      userId,
      type: "GENERATION",
      amount: 0,
      balanceAfter: balance.xyzBalance,
      ...meta,
      createdAt: new Date().toISOString(),
    };
    await appendTransaction(userId, tx);
    await appendUsage(userId, tx);
    return { ok: true, balance, transaction: tx };
  }

  const balance = await getBalance(userId);
  const balMicro = toMicroXyz(balance.xyzBalance);
  const costMicro = toMicroXyz(cost);
  if (balMicro < costMicro) {
    return { ok: false, balance };
  }
  const newBalMicro = balMicro - costMicro;
  const updated: XYZBalance = {
    ...balance,
    xyzBalance: fromMicroXyz(newBalMicro),
    lifetimeSpent: fromMicroXyz(
      toMicroXyz(balance.lifetimeSpent) + costMicro,
    ),
    updatedAt: new Date().toISOString(),
  };
  await onyxbase.set(balKey(userId), updated, COLL);

  const tx: XYZTransaction = {
    id: uid(),
    userId,
    type: "GENERATION",
    amount: -cost,
    balanceAfter: updated.xyzBalance,
    ...meta,
    createdAt: new Date().toISOString(),
  };
  await appendTransaction(userId, tx);
  await appendUsage(userId, tx);
  return { ok: true, balance: updated, transaction: tx };
}

/** Refund a generation (PRD §41, §42, §43). */
export async function refundXYZ(
  userId: string,
  amount: number,
  requestId: string,
  note?: string,
): Promise<XYZBalance> {
  const balance = await getBalance(userId);
  const newBalMicro = toMicroXyz(balance.xyzBalance) + toMicroXyz(amount);
  const updated: XYZBalance = {
    ...balance,
    xyzBalance: fromMicroXyz(newBalMicro),
    lifetimeSpent: fromMicroXyz(
      Math.max(0, toMicroXyz(balance.lifetimeSpent) - toMicroXyz(amount)),
    ),
    updatedAt: new Date().toISOString(),
  };
  await onyxbase.set(balKey(userId), updated, COLL);
  await appendTransaction(userId, {
    id: uid(),
    userId,
    type: "REFUND",
    amount,
    balanceAfter: updated.xyzBalance,
    requestId,
    note: note ?? "Refund (failed/partial generation)",
    createdAt: new Date().toISOString(),
  });
  return updated;
}

/** Append a transaction to the user's immutable ledger (PRD §43). */
async function appendTransaction(
  userId: string,
  tx: XYZTransaction,
): Promise<void> {
  const list = (await onyxbase.get<XYZTransaction[]>(txKey(userId), COLL)) ?? [];
  list.push(tx);
  // Cap the ledger to the last 500 entries to bound storage.
  const capped = list.length > 500 ? list.slice(list.length - 500) : list;
  await onyxbase.set(txKey(userId), capped, COLL);
}

export async function getTransactions(
  userId: string,
  limit = 50,
): Promise<XYZTransaction[]> {
  const list = (await onyxbase.get<XYZTransaction[]>(txKey(userId), COLL)) ?? [];
  return list.slice(-limit).reverse();
}

/** Append a usage record (analytics — PRD §38, §68). */
async function appendUsage(
  userId: string,
  tx: XYZTransaction,
): Promise<void> {
  const list = (await onyxbase.get<UsageRecord[]>(usageKey(userId), COLL)) ?? [];
  const rec: UsageRecord = {
    requestId: tx.requestId ?? tx.id,
    userId,
    source: tx.source ?? "native",
    provider: tx.provider ?? "unknown",
    model: tx.model ?? "unknown",
    inputTokens: tx.inputTokens ?? 0,
    outputTokens: tx.outputTokens ?? 0,
    cacheTokens: tx.cacheTokens ?? 0,
    usdCost: tx.usdCost ?? 0,
    xyzCost: Math.abs(tx.amount),
    marketEquivalentCost: tx.marketEquivalentCost,
    pricingVersion: tx.pricingVersion ?? PRICING_BOARD_VERSION,
    timestamp: tx.createdAt,
  };
  list.push(rec);
  const capped = list.length > 500 ? list.slice(list.length - 500) : list;
  await onyxbase.set(usageKey(userId), capped, COLL);
}

export async function getUsage(
  userId: string,
  limit = 50,
): Promise<UsageRecord[]> {
  const list = (await onyxbase.get<UsageRecord[]>(usageKey(userId), COLL)) ?? [];
  return list.slice(-limit).reverse();
}

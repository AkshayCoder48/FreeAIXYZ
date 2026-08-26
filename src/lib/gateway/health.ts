/**
 * Provider + model health service with circuit breaker (PRD §46-48, §121-123).
 *
 * Per-provider circuit breaker: healthy → (N consecutive failures) → open
 * (60s cooldown) → half-open (1 probe) → healthy/closed. NEVER permanently
 * hides a provider (PRD §122). Model-level health tracks failure counts and
 * downgrades status to degraded/offline.
 *
 * Outcomes are recorded by the streaming-proxy on every successful /
 * failed stream and by the health-check background loop.
 */

import { db } from "@/lib/db";
import { catalogStore } from "@/lib/gateway/catalog";
import { providerRegistry } from "@/lib/gateway/registry";
import type {
  HealthResult,
  ModelStatus,
  ProviderStatus,
} from "@/lib/gateway/types";

const FAILURE_THRESHOLD = 5; // consecutive failures → open (PRD §121)
const COOLDOWN_MS = 60 * 1000; // 60s (PRD §121)
const SUCCESS_WINDOW = 10; // rolling window for success-rate calc
const MODEL_DEGRADED_FAILURES = 2;
const MODEL_OFFLINE_FAILURES = 5;

type BreakerState = "closed" | "open" | "half_open";

interface BreakerEntry {
  status: BreakerState;
  consecutiveFailures: number;
  openedAt?: number;
  successes: boolean[]; // rolling window
}

interface ModelHealthInternal {
  status: ModelStatus;
  failureCount: number;
  lastSuccess?: string;
  lastFailure?: string;
  latencyMs?: number;
}

class ProviderHealthService {
  private breakers = new Map<string, BreakerEntry>();
  private modelHealth = new Map<string, ModelHealthInternal>();

  // ─── Provider-level health + circuit breaker ─────────────────────────────

  /** Run a provider's adapter.healthCheck() and update circuit state. */
  async checkProvider(providerId: string): Promise<HealthResult> {
    const adapter = providerRegistry.get(providerId);
    const lastChecked = new Date().toISOString();
    if (!adapter?.healthCheck) {
      const result: HealthResult = {
        providerId,
        status: "unknown" as ProviderStatus,
        lastChecked,
        message: "adapter has no healthCheck()",
      };
      catalogStore.setProviderHealth(providerId, result);
      return result;
    }
    const breaker = this.getBreaker(providerId);
    if (breaker.status === "open") {
      const elapsed = Date.now() - (breaker.openedAt ?? 0);
      if (elapsed < COOLDOWN_MS) {
        const result: HealthResult = {
          providerId,
          status: "offline" as ProviderStatus,
          lastChecked,
          message: `circuit open (cooldown ${Math.round((COOLDOWN_MS - elapsed) / 1000)}s)`,
        };
        catalogStore.setProviderHealth(providerId, result);
        return result;
      }
      // Cooldown elapsed → half-open probe (PRD §122).
      breaker.status = "half_open";
    }
    try {
      const result = await adapter.healthCheck();
      this.recordProviderOutcome(
        providerId,
        result.status === "healthy",
      );
      const successRate = this.computeSuccessRate(providerId);
      const enriched: HealthResult = {
        ...result,
        lastChecked,
        successRate,
        errorRate: 1 - successRate,
      };
      catalogStore.setProviderHealth(providerId, enriched);
      this.persistProviderHealth(providerId, enriched).catch((err) =>
        console.error(`[gateway.health] provider persist ${providerId}:`, err),
      );
      return enriched;
    } catch (err) {
      this.recordProviderOutcome(providerId, false, err);
      const result: HealthResult = {
        providerId,
        status: "offline" as ProviderStatus,
        lastChecked,
        message: err instanceof Error ? err.message : String(err),
      };
      catalogStore.setProviderHealth(providerId, result);
      return result;
    }
  }

  /** True if the circuit breaker is currently open for this provider. */
  isOpen(providerId: string): boolean {
    const b = this.breakers.get(providerId);
    if (!b) return false;
    if (b.status === "open") {
      const elapsed = Date.now() - (b.openedAt ?? 0);
      if (elapsed >= COOLDOWN_MS) {
        // Auto-promote to half-open on next check (PRD §122).
        b.status = "half_open";
        return false;
      }
      return true;
    }
    return false;
  }

  /** Record a successful outcome (called by streaming-proxy on 2xx). */
  recordProviderSuccess(providerId: string): void {
    this.recordProviderOutcome(providerId, true);
  }

  /** Record a failed outcome (called by streaming-proxy on err/5xx). */
  recordProviderFailure(providerId: string, err?: unknown): void {
    this.recordProviderOutcome(providerId, false, err);
  }

  private recordProviderOutcome(
    providerId: string,
    success: boolean,
    err?: unknown,
  ): void {
    const b = this.getBreaker(providerId);
    b.successes.push(success);
    if (b.successes.length > SUCCESS_WINDOW) b.successes.shift();
    if (success) {
      b.consecutiveFailures = 0;
      if (b.status === "half_open") b.status = "closed";
    } else {
      b.consecutiveFailures += 1;
      if (
        b.status === "half_open" ||
        b.consecutiveFailures >= FAILURE_THRESHOLD
      ) {
        b.status = "open";
        b.openedAt = Date.now();
      }
      if (err) {
        console.warn(
          `[gateway.health] provider ${providerId} failure:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  private getBreaker(providerId: string): BreakerEntry {
    let b = this.breakers.get(providerId);
    if (!b) {
      b = { status: "closed", consecutiveFailures: 0, successes: [] };
      this.breakers.set(providerId, b);
    }
    return b;
  }

  private computeSuccessRate(providerId: string): number {
    const b = this.breakers.get(providerId);
    if (!b || b.successes.length === 0) return 0;
    const ok = b.successes.filter(Boolean).length;
    return ok / b.successes.length;
  }

  // ─── Model-level health (PRD §47) ────────────────────────────────────────

  /** Record a successful model request — decay failures, restore status. */
  recordModelSuccess(publicId: string): void {
    const entry =
      this.modelHealth.get(publicId) ??
      ({ status: "active" as ModelStatus, failureCount: 0 } as ModelHealthInternal);
    entry.lastSuccess = new Date().toISOString();
    if (entry.failureCount > 0) {
      entry.failureCount = Math.max(0, entry.failureCount - 1);
    }
    if (entry.status === "degraded" && entry.failureCount === 0) {
      entry.status = "active";
    }
    this.modelHealth.set(publicId, entry);
    catalogStore.setModelHealth(publicId, entry.status, entry.latencyMs);
    this.persistModelHealth(publicId, entry).catch((err) =>
      console.error(`[gateway.health] model persist ${publicId}:`, err),
    );
  }

  /** Record a failed model request — bump failures, downgrade status. */
  recordModelFailure(publicId: string, err?: unknown): void {
    const entry =
      this.modelHealth.get(publicId) ??
      ({ status: "active" as ModelStatus, failureCount: 0 } as ModelHealthInternal);
    entry.failureCount += 1;
    entry.lastFailure = new Date().toISOString();
    if (entry.failureCount >= MODEL_OFFLINE_FAILURES) {
      entry.status = "offline";
    } else if (entry.failureCount >= MODEL_DEGRADED_FAILURES) {
      entry.status = "degraded";
    }
    this.modelHealth.set(publicId, entry);
    catalogStore.setModelHealth(publicId, entry.status, entry.latencyMs);
    this.persistModelHealth(publicId, entry).catch((err) =>
      console.error(`[gateway.health] model persist ${publicId}:`, err),
    );
    if (err) {
      console.warn(
        `[gateway.health] model ${publicId} failure:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  getModelHealth(publicId: string): ModelHealthInternal | undefined {
    return this.modelHealth.get(publicId);
  }

  // ─── Persistence (best-effort) ───────────────────────────────────────────

  private async persistProviderHealth(
    providerId: string,
    result: HealthResult,
  ): Promise<void> {
    try {
      await db.provider.update({
        where: { id: providerId },
        data: {
          status: result.status,
          latencyMs: result.latencyMs ?? null,
          lastHealthCheckAt: new Date(result.lastChecked),
          successRate: result.successRate ?? null,
          errorRate: result.errorRate ?? null,
        },
      });
    } catch (err) {
      // Provider row may not exist yet (e.g. before first discovery). Tolerate.
      console.error(`[gateway.health] provider update ${providerId}:`, err);
    }
  }

  private async persistModelHealth(
    publicId: string,
    entry: ModelHealthInternal,
  ): Promise<void> {
    try {
      // ModelHealth.modelId references ProviderModel.id (cuid), not publicId.
      const row = await db.providerModel.findUnique({
        where: { publicId },
      });
      if (!row) return;
      await db.modelHealth.upsert({
        where: { modelId: row.id },
        create: {
          modelId: row.id,
          status: entry.status,
          failureCount: entry.failureCount,
          lastFailure: entry.lastFailure ? new Date(entry.lastFailure) : null,
          lastSuccess: entry.lastSuccess ? new Date(entry.lastSuccess) : null,
          lastChecked: new Date(),
          latencyMs: entry.latencyMs ?? null,
        },
        update: {
          status: entry.status,
          failureCount: entry.failureCount,
          lastFailure: entry.lastFailure ? new Date(entry.lastFailure) : null,
          lastSuccess: entry.lastSuccess ? new Date(entry.lastSuccess) : null,
          lastChecked: new Date(),
          latencyMs: entry.latencyMs ?? null,
        },
      });
    } catch (err) {
      console.error(`[gateway.health] model health ${publicId}:`, err);
    }
  }
}

// globalThis-backed singleton (see catalog.ts / registry.ts for the pattern).
const globalForHealth = globalThis as unknown as {
  __freeaixyzProviderHealthService?: ProviderHealthService;
};

export const providerHealthService: ProviderHealthService =
  globalForHealth.__freeaixyzProviderHealthService ?? new ProviderHealthService();

if (!globalForHealth.__freeaixyzProviderHealthService) {
  globalForHealth.__freeaixyzProviderHealthService = providerHealthService;
}

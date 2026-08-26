/**
 * In-memory API metrics store (PRD §115-117).
 *
 * Rolling 1000-request ring buffer. Recent errors kept last 50 (PRD §117).
 * No DB persistence — the debug UI polls this directly.
 */

import type { ApiMetrics, StreamTimings } from "@/lib/gateway/types";

const RING_BUFFER_SIZE = 1000;
const RECENT_ERRORS_LIMIT = 50;
const STREAM_TIMINGS_LIMIT = 200;

export interface RequestMetric {
  requestId: string;
  providerId?: string;
  modelId?: string;
  status: number;
  type: string;
  message: string;
  streamRequested: boolean;
  ttftMs?: number;
  durationMs?: number;
  at: string;
}

class MetricsService {
  private ring: RequestMetric[] = [];
  private ringHead = 0;
  private ringCount = 0;
  private streamTimings: StreamTimings[] = [];
  private providerFailures: Record<string, number> = {};

  /** Record a single request outcome (PRD §115). */
  recordRequest(m: Omit<RequestMetric, "at">): void {
    const metric: RequestMetric = { ...m, at: new Date().toISOString() };
    if (this.ringCount < RING_BUFFER_SIZE) {
      this.ring.push(metric);
      this.ringCount += 1;
    } else {
      this.ring[this.ringHead] = metric;
      this.ringHead = (this.ringHead + 1) % RING_BUFFER_SIZE;
    }
    if (m.status >= 500 && m.providerId) {
      this.providerFailures[m.providerId] =
        (this.providerFailures[m.providerId] ?? 0) + 1;
    }
  }

  /** Record full stream timings for the debug UI (PRD §6). */
  recordStreamTimings(t: StreamTimings): void {
    this.streamTimings.push(t);
    if (this.streamTimings.length > STREAM_TIMINGS_LIMIT) {
      this.streamTimings.shift();
    }
  }

  /** Compute aggregate metrics over the rolling window (PRD §115-117). */
  getMetrics(): ApiMetrics {
    const total = this.ringCount;
    if (total === 0) {
      return {
        requests: 0,
        successRate: 0,
        errors: 0,
        streamingRequests: 0,
        averageTtftMs: 0,
        averageLatencyMs: 0,
        providerFailures: { ...this.providerFailures },
        recentErrors: [],
      };
    }
    let successes = 0;
    let errors = 0;
    let streaming = 0;
    let ttftSum = 0;
    let ttftN = 0;
    let durSum = 0;
    let durN = 0;
    const errorQueue: RequestMetric[] = [];
    for (let i = 0; i < this.ringCount; i++) {
      const idx = (this.ringHead + i) % RING_BUFFER_SIZE;
      const m = this.ring[idx];
      if (!m) continue;
      if (m.status >= 200 && m.status < 400) successes += 1;
      else errors += 1;
      if (m.streamRequested) streaming += 1;
      if (m.ttftMs !== undefined) {
        ttftSum += m.ttftMs;
        ttftN += 1;
      }
      if (m.durationMs !== undefined) {
        durSum += m.durationMs;
        durN += 1;
      }
      if (m.status >= 400) {
        errorQueue.push(m);
        if (errorQueue.length > RECENT_ERRORS_LIMIT) errorQueue.shift();
      }
    }
    return {
      requests: total,
      successRate: successes / total,
      errors,
      streamingRequests: streaming,
      averageTtftMs: ttftN > 0 ? ttftSum / ttftN : 0,
      averageLatencyMs: durN > 0 ? durSum / durN : 0,
      providerFailures: { ...this.providerFailures },
      recentErrors: errorQueue.map((m) => ({
        requestId: m.requestId,
        providerId: m.providerId,
        modelId: m.modelId,
        status: m.status,
        type: m.type,
        message: m.message,
        at: m.at,
      })),
    };
  }

  /** Snapshot of recent stream timings (debug UI, PRD §6). */
  getStreamTimings(): StreamTimings[] {
    return [...this.streamTimings];
  }

  /** Reset all metrics (admin/debug only). */
  reset(): void {
    this.ring = [];
    this.ringHead = 0;
    this.ringCount = 0;
    this.streamTimings = [];
    this.providerFailures = {};
  }
}

// globalThis-backed singleton (see catalog.ts / registry.ts for the pattern).
const globalForMetrics = globalThis as unknown as {
  __freeaixyzMetricsService?: MetricsService;
};

export const metricsService: MetricsService =
  globalForMetrics.__freeaixyzMetricsService ?? new MetricsService();

if (!globalForMetrics.__freeaixyzMetricsService) {
  globalForMetrics.__freeaixyzMetricsService = metricsService;
}

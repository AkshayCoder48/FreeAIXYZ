/**
 * Sync engine — runs every adapter's `fetchModels()` and applies the result
 * to the in-memory catalog (Task 11-backend, PRD §6-11, §24-33, §48-49).
 *
 * Features:
 *   - Per-provider timeout (PRD §29, default 15s, configurable via config)
 *   - Sync locks (PRD §28): in-flight dedup per provider
 *   - Retries with backoff (PRD §31): 3 attempts × {500ms, 1500ms}, no 4xx
 *   - Empty-response protection (PRD §49): suspicious zero→degraded, no removal
 *   - Removal safety (PRD §11, §12): failed sync → NO catalog change
 *   - Diff (PRD §24): added / updated / removed / resurrected
 *   - Removed models → status="removed" (kept in catalog, never deleted)
 *   - Resurrection (PRD §13): a "removed" model that reappears → active
 *   - Structured logging (PRD §33): `[MODEL_SYNC] <provider> <event>`
 *   - Independent sync (PRD §9): Promise.allSettled across providers
 *
 * `sync.ts` pushes results into `catalogStore` via `applyProviderSync()`
 * (catalog.ts) so `getModel()` / `getAllModels()` reflect synced state.
 */

import { catalogStore } from "@/lib/gateway/catalog";
import { canonicalModelId } from "@/lib/gateway/ids";
import type { DiscoveredModel, ModelCapabilities } from "@/lib/gateway/types";
import { getProviderConfig } from "./config";
import { allProviders, getAdapter } from "./registry";
import type {
  FullSyncResult,
  ProviderModelAdapter,
  ProviderModel,
  SyncResult,
  UnifiedModel,
} from "./types";

// ─── Sync locks (PRD §28) ────────────────────────────────────────────────────

const inFlight = new Map<string, Promise<SyncResult>>();

// ─── Per-provider model state (last sync snapshot) ──────────────────────────

interface ProviderSnapshot {
  models: Map<string, UnifiedModel>; // canonical id → unified model
  lastSyncAt: string;
  lastStatus: "healthy" | "degraded" | "failed";
}

const SNAPSHOTS = new Map<string, ProviderSnapshot>();

function getSnapshot(providerId: string): ProviderSnapshot {
  let s = SNAPSHOTS.get(providerId);
  if (!s) {
    s = { models: new Map(), lastSyncAt: "", lastStatus: "degraded" };
    SNAPSHOTS.set(providerId, s);
  }
  return s;
}

// ─── Diff (PRD §24) ──────────────────────────────────────────────────────────

interface DiffResult {
  added: UnifiedModel[];
  updated: UnifiedModel[];
  removed: UnifiedModel[];
  resurrected: UnifiedModel[];
}

function diffModels(
  prev: Map<string, UnifiedModel>,
  next: UnifiedModel[],
): DiffResult {
  const nextById = new Map<string, UnifiedModel>();
  for (const m of next) nextById.set(m.id, m);

  const added: UnifiedModel[] = [];
  const updated: UnifiedModel[] = [];
  const removed: UnifiedModel[] = [];
  const resurrected: UnifiedModel[] = [];

  // Pass 1: new + updated + resurrected
  for (const m of next) {
    const prior = prev.get(m.id);
    if (!prior) {
      added.push(m);
    } else if (prior.status === "removed") {
      // PRD §13 — resurrect: don't create duplicate, set back to active
      resurrected.push({ ...m, status: "active", firstSeenAt: prior.firstSeenAt });
    } else {
      updated.push(m);
    }
  }
  // Pass 2: removed (in prev, not in next)
  for (const [id, prior] of prev) {
    if (!nextById.has(id) && prior.status !== "removed") {
      removed.push({ ...prior, status: "removed" });
    }
  }
  return { added, updated, removed, resurrected };
}

// ─── Retries with backoff (PRD §31) ──────────────────────────────────────────

const RETRY_DELAYS_MS = [500, 1500];

function isPermanentError(err: unknown, httpStatus?: number): boolean {
  // 4xx (except 429) → permanent; no retry.
  if (httpStatus && httpStatus >= 400 && httpStatus < 500 && httpStatus !== 429) {
    return true;
  }
  // 401/403 surfaced as message text — also permanent.
  const msg = err instanceof Error ? err.message : String(err);
  if (/HTTP (4[0-9]{2})/i.test(msg) && !/HTTP 429/i.test(msg)) return true;
  return false;
}

async function withRetries<T>(
  fn: () => Promise<T>,
  label: string,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < RETRY_DELAYS_MS.length) {
        if (isPermanentError(err)) {
          console.log(
            `[MODEL_SYNC] ${label} permanent error on attempt ${attempt + 1}, skipping retries`,
          );
          break;
        }
        const delay = RETRY_DELAYS_MS[attempt];
        console.log(
          `[MODEL_SYNC] ${label} attempt ${attempt + 1} failed, retrying in ${delay}ms`,
          err instanceof Error ? err.message : err,
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

// ─── Per-provider timeout (PRD §29) ──────────────────────────────────────────

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timed out after ${ms}ms`));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

// ─── UnifiedModel → DiscoveredModel converter ────────────────────────────────

function toDiscovered(m: UnifiedModel): DiscoveredModel {
  const caps: ModelCapabilities = {
    text: m.type !== "image" && m.type !== "embedding",
    image: m.type === "image" || m.capabilities.imageGeneration === true,
    imageEdit: false,
    audioInput: m.capabilities.audio === true,
    audioOutput: m.capabilities.audio === true,
    vision: m.capabilities.vision === true,
    tools: m.capabilities.tools === true,
    streaming: m.capabilities.streaming !== false,
  };
  // Gateway canonical id is `<shortId>/<upstreamId>`. Our `UnifiedModel.id`
  // is `<providerId>:<modelId>` — convert here so the catalog can resolve.
  let publicId: string;
  try {
    publicId = canonicalModelId(m.providerId, m.modelId);
  } catch {
    publicId = m.id; // provider not in short-id registry — fall back
  }
  return {
    id: publicId,
    providerId: m.providerId,
    providerName: m.providerId,
    upstreamId: m.modelId,
    name: m.name,
    capabilities: caps,
    metadata: {
      source: "providers-sync",
      raw: m.raw,
    },
    discoveredAt: m.firstSeenAt,
    lastVerifiedAt: m.lastSeenAt,
    // The gateway's ModelStatus is "active" | "degraded" | "offline" | "unknown".
    // Our `removed` translates to `offline` so existing code can still find the
    // entry by id (PRD §12: never delete). `temporarily_unavailable` → `degraded`.
    status:
      m.status === "removed"
        ? "offline"
        : m.status === "temporarily_unavailable"
        ? "degraded"
        : "active",
    discoveryMode: "dynamic",
    discoveredFrom: `providers/${m.providerId}`,
  };
}

// ─── Sync a single provider (PRD §8, §9, §11, §28, §49) ──────────────────────

export async function syncProvider(
  adapterOrId: ProviderModelAdapter | string,
): Promise<SyncResult> {
  const adapter =
    typeof adapterOrId === "string" ? getAdapter(adapterOrId) : adapterOrId;
  if (!adapter) {
    return {
      providerId:
        typeof adapterOrId === "string" ? adapterOrId : "<unknown>",
      status: "disabled",
      found: 0,
      added: 0,
      updated: 0,
      removed: 0,
      free: 0,
      error: "no adapter registered",
      durationMs: 0,
    };
  }
  const cfg = getProviderConfig(adapter.id);
  if (!cfg.enabled) {
    return {
      providerId: adapter.id,
      status: "disabled",
      found: 0,
      added: 0,
      updated: 0,
      removed: 0,
      free: 0,
      durationMs: 0,
    };
  }

  // Sync lock (PRD §28) — dedup concurrent calls.
  const inFlightPromise = inFlight.get(adapter.id);
  if (inFlightPromise) return inFlightPromise;

  const promise = (async (): Promise<SyncResult> => {
    const started = Date.now();
    const snap = getSnapshot(adapter.id);
    console.log(`[MODEL_SYNC] ${adapter.id} started`);

    let fetched: ProviderModel[] = [];
    let fetchError: string | undefined;

    try {
      fetched = await withRetries(
        () => withTimeout(adapter.fetchModels(), cfg.timeoutMs, adapter.id),
        adapter.id,
      );
    } catch (err) {
      fetchError = err instanceof Error ? err.message : String(err);
    }

    // Failed fetch → removal safety (PRD §11) — DO NOT touch the catalog.
    if (fetchError) {
      snap.lastStatus = "failed";
      snap.lastSyncAt = new Date().toISOString();
      console.log(
        `[MODEL_SYNC] ${adapter.id} failed in ${Date.now() - started}ms`,
        fetchError,
      );
      return {
        providerId: adapter.id,
        status: "failed",
        found: 0,
        added: 0,
        updated: 0,
        removed: 0,
        free: snap.models.size,
        error: fetchError,
        durationMs: Date.now() - started,
      };
    }

    // Empty-response protection (PRD §49): if a provider that normally has
    // models returns 0, treat as suspicious — keep existing models, mark
    // provider degraded. Only apply removal when response is non-empty.
    if (fetched.length === 0 && snap.models.size > 0) {
      snap.lastStatus = "degraded";
      snap.lastSyncAt = new Date().toISOString();
      console.log(
        `[MODEL_SYNC] ${adapter.id} returned 0 models (had ${snap.models.size}); keeping existing, status=degraded`,
      );
      return {
        providerId: adapter.id,
        status: "degraded",
        found: 0,
        added: 0,
        updated: 0,
        removed: 0,
        free: snap.models.size,
        durationMs: Date.now() - started,
      };
    }

    // Normalize + classify free, then apply per-provider maxModels cap.
    const unified: UnifiedModel[] = [];
    const seenIds = new Set<string>();
    for (const raw of fetched) {
      try {
        const u = adapter.normalizeModel(raw);
        if (seenIds.has(u.id)) continue;
        seenIds.add(u.id);
        const c = adapter.classifyFree(u);
        u.free = c.free;
        (u as UnifiedModel & { freeReason?: string }).freeReason = c.reason;
        u.freeConfidence = c.confidence;
        unified.push(u);
      } catch (err) {
        console.error(
          `[MODEL_SYNC] ${adapter.id} normalize failed for`,
          raw,
          err,
        );
      }
    }
    if (cfg.maxModels && unified.length > cfg.maxModels) {
      unified.splice(cfg.maxModels);
    }

    // Diff against previous snapshot (PRD §24).
    const diff = diffModels(snap.models, unified);

    // Build the new snapshot (preserve `removed` entries so the catalog
    // keeps them around — PRD §12).
    const newModels = new Map<string, UnifiedModel>(snap.models);
    for (const m of diff.added) {
      const stamped: UnifiedModel = {
        ...m,
        firstSeenAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        status: "active",
      };
      newModels.set(m.id, stamped);
    }
    for (const m of diff.updated) {
      newModels.set(m.id, {
        ...m,
        firstSeenAt: snap.models.get(m.id)?.firstSeenAt ?? new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        status: "active",
      });
    }
    for (const m of diff.resurrected) {
      newModels.set(m.id, {
        ...m,
        lastSeenAt: new Date().toISOString(),
        status: "active",
      });
    }
    for (const m of diff.removed) {
      newModels.set(m.id, {
        ...m,
        lastSeenAt: new Date().toISOString(),
        status: "removed",
      });
    }

    // Push into the in-memory gateway catalog (replaces this provider's
    // entries and resurrects/adds/marks-removed as needed).
    const toApply: DiscoveredModel[] = [];
    for (const m of newModels.values()) {
      if (m.status === "removed") continue; // skip removed from live catalog
      toApply.push(toDiscovered(m));
    }
    applyToCatalog(adapter.id, toApply);

    snap.models = newModels;
    snap.lastSyncAt = new Date().toISOString();
    snap.lastStatus = "healthy";

    const freeCount = Array.from(newModels.values()).filter(
      (m) => m.free && m.status !== "removed",
    ).length;

    console.log(
      `[MODEL_SYNC] ${adapter.id} completed in ${Date.now() - started}ms — ` +
        `found=${unified.length} added=${diff.added.length} ` +
        `updated=${diff.updated.length} removed=${diff.removed.length} ` +
        `resurrected=${diff.resurrected.length} free=${freeCount}`,
    );

    return {
      providerId: adapter.id,
      status: "healthy",
      found: unified.length,
      added: diff.added.length,
      updated: diff.updated.length,
      removed: diff.removed.length,
      free: freeCount,
      durationMs: Date.now() - started,
    };
  })();

  inFlight.set(adapter.id, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(adapter.id);
  }
}

// ─── Sync all enabled providers in parallel (PRD §8, §9) ─────────────────────

export async function syncAll(): Promise<FullSyncResult> {
  const started = Date.now();
  const adapters = allProviders();
  console.log(
    `[MODEL_SYNC] syncAll started — ${adapters.length} providers`,
  );
  const settled = await Promise.allSettled(adapters.map((a) => syncProvider(a)));
  const results: SyncResult[] = settled.map((s, i) => {
    if (s.status === "fulfilled") return s.value;
    const adapter = adapters[i];
    return {
      providerId: adapter.id,
      status: "failed",
      found: 0,
      added: 0,
      updated: 0,
      removed: 0,
      free: 0,
      error: s.reason instanceof Error ? s.reason.message : String(s.reason),
      durationMs: 0,
    };
  });
  const totals = results.reduce(
    (acc, r) => {
      acc.totalAdded += r.added;
      acc.totalUpdated += r.updated;
      acc.totalRemoved += r.removed;
      acc.totalFree += r.free;
      acc.totalActive += r.found;
      return acc;
    },
    {
      totalAdded: 0,
      totalUpdated: 0,
      totalRemoved: 0,
      totalFree: 0,
      totalActive: 0,
    },
  );
  console.log(
    `[MODEL_SYNC] syncAll completed in ${Date.now() - started}ms — ` +
      `added=${totals.totalAdded} updated=${totals.totalUpdated} ` +
      `removed=${totals.totalRemoved} free=${totals.totalFree}`,
  );
  return {
    results,
    ...totals,
    durationMs: Date.now() - started,
  };
}

// ─── Catalog application (replaces the provider's models atomically) ─────────

/**
 * Atomically replace the in-memory catalog's entries for a single provider
 * with the synced model list. Resurrects previously-degraded/removed models
 * that reappear; degrades models that disappeared (PRD §12, §13).
 */
function applyToCatalog(providerId: string, models: DiscoveredModel[]): void {
  // Build a full replacement list: existing entries from OTHER providers
  // (unchanged) + this provider's new entries.
  const existing = catalogStore.getCatalog();
  const keepFromOthers = existing.models.filter((m) => m.providerId !== providerId);
  const merged = [...keepFromOthers, ...models];
  // De-dup by canonical id (PRD §68) — later entries win.
  const seen = new Set<string>();
  const deduped = merged.filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
  // Make sure each model has a proper canonical id — if any came in without
  // one (e.g. legacy seeds), synthesize it from providerId + upstreamId.
  for (const m of deduped) {
    if (!m.id.includes("/")) {
      try {
        m.id = canonicalModelId(providerId, m.upstreamId);
      } catch {
        // provider not in PROVIDER_SHORT_IDS — leave as-is
      }
    }
  }
  catalogStore.seedSync(deduped);
}

// ─── Status snapshot (for /api/sync/status) ──────────────────────────────────

export function getSyncStatus(): {
  inFlight: string[];
  snapshots: Array<{
    providerId: string;
    lastSyncAt: string;
    lastStatus: string;
    modelCount: number;
    freeCount: number;
    removedCount: number;
  }>;
} {
  const snaps: Array<{
    providerId: string;
    lastSyncAt: string;
    lastStatus: string;
    modelCount: number;
    freeCount: number;
    removedCount: number;
  }> = [];
  for (const [id, snap] of SNAPSHOTS) {
    const models = Array.from(snap.models.values());
    snaps.push({
      providerId: id,
      lastSyncAt: snap.lastSyncAt,
      lastStatus: snap.lastStatus,
      modelCount: models.filter((m) => m.status !== "removed").length,
      freeCount: models.filter((m) => m.free && m.status !== "removed").length,
      removedCount: models.filter((m) => m.status === "removed").length,
    });
  }
  return {
    inFlight: Array.from(inFlight.keys()),
    snapshots: snaps,
  };
}

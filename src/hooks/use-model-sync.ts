"use client";

/**
 * useModelSync — background model-registry sync hook (PRD §6, §7, §28, §29).
 *
 * Triggers a real-time model sync via `POST /api/sync/refresh`:
 *  - On mount (PRD §6) — app opens: show cached models first, then sync.
 *  - On tab visibilitychange / page load (PRD §7) — sync when user returns.
 *
 * Dedup (PRD §28): a module-level `syncingPromise` ensures only one in-flight
 * sync at a time across all callers in the same tab.
 *
 * Multi-tab broadcast (PRD §29): uses `BroadcastChannel("freeaixyz-sync")`
 * to fan out the sync result to other open tabs so they update their UI
 * without re-fetching. Falls back to `localStorage` event for browsers
 * without BroadcastChannel.
 *
 * Returns `{ syncing, lastSyncAt, result, error, refresh }`.
 *
 * Endpoint strategy: tries `/api/sync/refresh` first (the unified-registry
 * endpoint). Falls back to `/api/discovery/refresh` on 404 (legacy gateway)
 * so the hook keeps working whether or not the backend subagent has shipped
 * the new unified-registry endpoint.
 */

import * as React from "react";

export interface SyncResult {
  /** Number of newly discovered models (was not in registry before). */
  added: number;
  /** Number of models whose metadata changed. */
  updated: number;
  /** Number of models that disappeared from upstream. */
  removed: number;
  /** Number of free models in the new registry snapshot. */
  free: number;
}

export interface SyncState {
  /** True while a sync is in-flight. */
  syncing: boolean;
  /** ISO timestamp of the last successful sync (null = never synced). */
  lastSyncAt: string | null;
  /** Diff result from the last sync (null = never synced or unknown diff). */
  result: SyncResult | null;
  /** Error message from the last sync attempt (null = no error). */
  error: string | null;
}

export interface UseModelSyncResult extends SyncState {
  /** Manually trigger a sync (PRD §8 — "Refresh Models" button). */
  refresh: () => Promise<SyncResult | null>;
}

// ────────────────────────────────────────────────────────────────────────────
// Module-level dedup lock (PRD §28). Shared across all useModelSync instances
// in the same tab so two callers can't double-fire a sync.
// ────────────────────────────────────────────────────────────────────────────

interface InternalSyncOutcome {
  ok: boolean;
  result: SyncResult | null;
  error: string | null;
  at: string;
}

let syncingPromise: Promise<InternalSyncOutcome> | null = null;

const BROADCAST_CHANNEL = "freeaixyz-sync";
const STORAGE_KEY = "freeaixyz:lastSyncAt";
const MIN_VISIBILITY_INTERVAL_MS = 30_000; // throttle tab-switch syncs

function readLastSyncAt(): string | null {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeLastSyncAt(iso: string): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, iso);
  } catch {
    // best-effort — sandboxed iframes can throw
  }
}

function computeResult(json: unknown): SyncResult | null {
  if (!json || typeof json !== "object") return null;
  const j = json as Record<string, unknown>;
  // Accept a few shapes:
  //   { added, updated, removed, free }
  //   { ok: true, results: [{ added, updated, removed, free }, ...] }   (legacy discovery shape — sum across providers)
  //   { ok: true, diff: { added, updated, removed, free } }
  const isNum = (v: unknown): v is number =>
    typeof v === "number" && Number.isFinite(v);
  if (isNum(j.added) || isNum(j.updated) || isNum(j.removed) || isNum(j.free)) {
    return {
      added: isNum(j.added) ? j.added : 0,
      updated: isNum(j.updated) ? j.updated : 0,
      removed: isNum(j.removed) ? j.removed : 0,
      free: isNum(j.free) ? j.free : 0,
    };
  }
  if (Array.isArray(j.results)) {
    let added = 0,
      updated = 0,
      removed = 0,
      free = 0;
    for (const r of j.results) {
      if (!r || typeof r !== "object") continue;
      const rr = r as Record<string, unknown>;
      if (isNum(rr.added)) added += rr.added;
      if (isNum(rr.updated)) updated += rr.updated;
      if (isNum(rr.removed)) removed += rr.removed;
      if (isNum(rr.free)) free += rr.free;
      // Some discovery results expose counts directly:
      if (isNum(rr.models) && !isNum(rr.added)) added += rr.models as number;
    }
    return { added, updated, removed, free };
  }
  if (j.diff && typeof j.diff === "object") {
    const d = j.diff as Record<string, unknown>;
    return {
      added: isNum(d.added) ? d.added : 0,
      updated: isNum(d.updated) ? d.updated : 0,
      removed: isNum(d.removed) ? d.removed : 0,
      free: isNum(d.free) ? d.free : 0,
    };
  }
  return null;
}

/**
 * The actual sync call. Dedup'd via module-level `syncingPromise` (PRD §28).
 * Resolves with an outcome object — never rejects (errors become `ok: false`).
 */
function runSync(): Promise<InternalSyncOutcome> {
  if (syncingPromise) return syncingPromise;
  const at = new Date().toISOString();
  syncingPromise = (async (): Promise<InternalSyncOutcome> => {
    // Try the new unified-registry endpoint first; fall back to legacy discovery
    // endpoint on 404 (PRD §173) so the hook keeps working pre-unified-registry.
    const endpoints = ["/api/sync/refresh", "/api/discovery/refresh"];
    let lastErr: string | null = null;
    for (const ep of endpoints) {
      try {
        const res = await fetch(ep, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
          cache: "no-store",
        });
        if (res.status === 404) {
          // Endpoint not yet provisioned by backend — try the next.
          continue;
        }
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          lastErr = `HTTP ${res.status}${text ? `: ${text.slice(0, 160)}` : ""}`;
          continue;
        }
        const json = await res.json().catch(() => null);
        const result = computeResult(json);
        return { ok: true, result, error: null, at };
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
        continue;
      }
    }
    return { ok: false, result: null, error: lastErr ?? "Sync failed", at };
  })()
    .catch(
      (e): InternalSyncOutcome => ({
        ok: false,
        result: null,
        error: e instanceof Error ? e.message : String(e),
        at,
      }),
    )
    .finally(() => {
      syncingPromise = null;
    });
  return syncingPromise;
}

// ────────────────────────────────────────────────────────────────────────────
// Hook
// ────────────────────────────────────────────────────────────────────────────

/**
 * Subscribe to (and trigger) background model-registry syncs.
 *
 * @param opts.enabled  Set false to disable auto-sync on mount/visibility
 *                      (e.g. in a disabled tab). Default true.
 */
export function useModelSync(opts: { enabled?: boolean } = {}): UseModelSyncResult {
  const enabled = opts.enabled !== false;
  const [state, setState] = React.useState<SyncState>(() => ({
    syncing: false,
    lastSyncAt: readLastSyncAt(),
    result: null,
    error: null,
  }));

  // Ref to track last sync time without re-running the visibility effect.
  const lastSyncAtRef = React.useRef<string | null>(state.lastSyncAt);
  React.useEffect(() => {
    lastSyncAtRef.current = state.lastSyncAt;
  }, [state.lastSyncAt]);

  const applyOutcome = React.useCallback((outcome: InternalSyncOutcome) => {
    if (outcome.ok) {
      writeLastSyncAt(outcome.at);
      lastSyncAtRef.current = outcome.at;
      setState({
        syncing: false,
        lastSyncAt: outcome.at,
        result: outcome.result,
        error: null,
      });
    } else {
      setState((prev) => ({
        ...prev,
        syncing: false,
        error: outcome.error,
      }));
    }
  }, []);

  const refresh = React.useCallback(async (): Promise<SyncResult | null> => {
    setState((prev) => ({ ...prev, syncing: true, error: null }));
    const outcome = await runSync();
    applyOutcome(outcome);
    return outcome.result;
  }, [applyOutcome]);

  // ── Sync on mount (PRD §6) ──────────────────────────────────────────────
  React.useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    // Read cached lastSyncAt; if we synced very recently (within last 30s),
    // skip the auto-sync to avoid hammering the backend on hot reloads / re-mounts.
    const lastIso = readLastSyncAt();
    const recentEnough =
      lastIso && Date.now() - Date.parse(lastIso) < MIN_VISIBILITY_INTERVAL_MS;
    if (recentEnough) {
      setState((prev) => ({ ...prev, lastSyncAt: lastIso }));
      return;
    }
    setState((prev) => ({ ...prev, syncing: true }));
    void (async () => {
      const outcome = await runSync();
      if (!cancelled) applyOutcome(outcome);
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, applyOutcome]);

  // ── Sync on visibilitychange / page show (PRD §7) ──────────────────────
  React.useEffect(() => {
    if (!enabled) return;
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      const lastIso = lastSyncAtRef.current;
      if (lastIso && Date.now() - Date.parse(lastIso) < MIN_VISIBILITY_INTERVAL_MS) {
        return; // throttled — synced very recently
      }
      setState((prev) => ({ ...prev, syncing: true, error: null }));
      void (async () => {
        const outcome = await runSync();
        applyOutcome(outcome);
      })();
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) onVisibility();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [enabled, applyOutcome]);

  // ── Multi-tab broadcast (PRD §29) ───────────────────────────────────────
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    // BroadcastChannel path
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel(BROADCAST_CHANNEL);
    } catch {
      bc = null;
    }
    const handler = (msg: { result: SyncResult | null; at: string; error: string | null } | null) => {
      if (!msg) return;
      writeLastSyncAt(msg.at);
      lastSyncAtRef.current = msg.at;
      setState({
        syncing: false,
        lastSyncAt: msg.at,
        result: msg.result,
        error: msg.error,
      });
    };
    if (bc) {
      const onMsg = (e: MessageEvent) => {
        if (!e.data || typeof e.data !== "object") return;
        handler(e.data as { result: SyncResult | null; at: string; error: string | null });
      };
      bc.onmessage = onMsg;
    } else {
      // Fallback: localStorage 'storage' event (cross-tab)
      const onStorage = (e: StorageEvent) => {
        if (e.key !== STORAGE_KEY || !e.newValue) return;
        handler({
          result: null, // we don't push the diff through localStorage — just the timestamp
          at: e.newValue,
          error: null,
        });
      };
      window.addEventListener("storage", onStorage);
      return () => window.removeEventListener("storage", onStorage);
    }
    return () => {
      bc?.close();
    };
  }, []);

  // ── After a local sync, broadcast to other tabs ──────────────────────────
  React.useEffect(() => {
    if (!state.lastSyncAt || !state.result) return;
    try {
      const bc = new BroadcastChannel(BROADCAST_CHANNEL);
      bc.postMessage({
        result: state.result,
        at: state.lastSyncAt,
        error: state.error,
      });
      bc.close();
    } catch {
      // best-effort — ignore
    }
  }, [state.lastSyncAt, state.result, state.error]);

  return { ...state, refresh };
}

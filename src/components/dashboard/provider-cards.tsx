"use client";

/**
 * ProviderCards — gateway provider grid (PRD §53, §103, §173).
 *
 * Fetches /api/providers and renders a card per provider with: short id chip,
 * status badge (green=healthy, amber=degraded, rose=offline), model counts,
 * streaming/image counts, latency, and "Last checked" relative time.
 *
 * "Refresh provider" button per card → POST /api/discovery/refresh with
 * `{ provider: shortId }` (PRD §173).
 *
 * Styled per Minimalist Modern design: rounded-xl cards, gradient accent on
 * status dot, hover lift, gradient refresh button.
 */

import * as React from "react";
import {
  RefreshCw,
  Server,
  Loader2,
  AlertTriangle,
  Zap,
  Image as ImageIcon,
  Clock,
  Gauge,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { useModelSync } from "@/hooks/use-model-sync";

interface ProviderEntry {
  id: string;
  shortId: string;
  name: string;
  status: string;
  models: number;
  streamingModels: number;
  imageModels: number;
  lastDiscovery?: string;
  lastHealthCheck?: string;
  latencyMs?: number;
}

interface ProvidersResponse {
  providers: ProviderEntry[];
}

function statusDotClass(status: string): string {
  switch (status) {
    case "healthy":
      return "bg-emerald-500";
    case "degraded":
      return "bg-amber-500";
    case "offline":
      return "bg-rose-500";
    default:
      return "bg-muted-foreground/40";
  }
}

function statusLabel(status: string): string {
  return status || "unknown";
}

function formatRelative(iso?: string): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const diff = Date.now() - t;
  if (diff < 0) return "just now";
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

interface ProviderCardsProps {
  /** Compact variant for landing page (fewer fields per card). */
  compact?: boolean;
  /** Limit number of cards shown. */
  limit?: number;
}

export function ProviderCards({ compact, limit }: ProviderCardsProps) {
  const [providers, setProviders] = React.useState<ProviderEntry[]>([]);
  const [loading, setLoading] = React.useState<boolean>(true);
  const [error, setError] = React.useState<string | null>(null);
  const [refreshingId, setRefreshingId] = React.useState<string | null>(null);
  // Real-time model-registry sync (PRD §6, §7, §28, §29).
  const modelSync = useModelSync();

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/providers", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Failed to load providers (HTTP ${res.status})`);
      }
      const json = (await res.json()) as ProvidersResponse;
      setProviders(json.providers ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  // Re-fetch provider list whenever a sync completes (PRD §45 — refresh UI
  // when the unified registry updates).
  React.useEffect(() => {
    if (modelSync.syncing || !modelSync.lastSyncAt) return;
    load();
  }, [modelSync.lastSyncAt, modelSync.syncing, load]);

  const refreshProvider = React.useCallback(
    async (shortId: string, id: string) => {
      setRefreshingId(id);
      try {
        // Try the unified-registry sync endpoint first; fall back to legacy
        // discovery refresh on 404 (PRD §173).
        const res = await fetch("/api/sync/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: shortId }),
        });
        if (res.status === 404) {
          const legacy = await fetch("/api/discovery/refresh", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider: shortId }),
          });
          if (!legacy.ok) {
            throw new Error(`Refresh ${shortId} failed (HTTP ${legacy.status})`);
          }
        } else if (!res.ok) {
          throw new Error(`Refresh ${shortId} failed (HTTP ${res.status})`);
        }
        await load();
      } catch {
        // best-effort; the explorer already surfaces errors
      } finally {
        setRefreshingId(null);
      }
    },
    [load],
  );

  const shown = limit ? providers.slice(0, limit) : providers;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg sm:text-xl font-semibold tracking-tight flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <Server className="h-4 w-4" strokeWidth={1.75} />
          </span>
          Providers ({providers.length})
        </h3>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void modelSync.refresh().then(() => load());
          }}
          disabled={modelSync.syncing}
          className="h-9 gap-1.5 text-[10px] uppercase tracking-[0.12em] border-accent text-accent hover:bg-accent hover:text-white rounded-full transition-all disabled:opacity-60 disabled:pointer-events-none"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          {modelSync.syncing ? (
            <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.75} />
          ) : (
            <RefreshCw className="h-3 w-3" strokeWidth={1.75} />
          )}
          Reload
        </Button>
      </div>

      {/* Global sync status bar (PRD §45) */}
      <SyncStatusBar sync={modelSync} />

      {error && (
        <Alert className="rounded-xl">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Provider load failed: {error}
          </AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div
          className={cn(
            "grid gap-4",
            compact ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-3",
          )}
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {shown.map((p) => {
            const isRefreshing = refreshingId === p.id;
            return (
              <div
                key={p.id}
                className="group rounded-xl border border-border bg-card p-4 flex flex-col gap-3 transition-all hover:border-accent/30 hover:shadow-accent hover:-translate-y-0.5"
              >
                <div className="flex items-start justify-between gap-2">
                  {/* PRD §36 — min-w-0 on the name container so truncate works. */}
                  <div className="min-w-0 flex-1">
                    <div
                      className="text-sm font-semibold truncate overflow-hidden text-ellipsis whitespace-nowrap text-foreground"
                      title={p.name}
                    >
                      {p.name}
                    </div>
                    <span
                      className="mt-1 inline-flex items-center px-2 py-0.5 rounded-md bg-accent/5 border border-accent/20 text-[10px] font-medium text-accent"
                      style={{ fontFamily: "var(--font-mono), monospace" }}
                    >
                      {p.shortId}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      className={cn(
                        "inline-block h-2 w-2 rounded-full",
                        statusDotClass(p.status),
                      )}
                    />
                    <span
                      className="text-[10px] uppercase tracking-[0.15em]"
                      style={{ fontFamily: "var(--font-mono), monospace" }}
                    >
                      {statusLabel(p.status)}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-[11px]">
                  <Stat label="models" value={p.models} icon={Server} />
                  <Stat label="streaming" value={p.streamingModels} icon={Zap} />
                  <Stat label="image" value={p.imageModels} icon={ImageIcon} />
                </div>

                {!compact && (
                  <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                    <span
                      className="flex items-center gap-1"
                      style={{ fontFamily: "var(--font-mono), monospace" }}
                    >
                      <Clock className="h-3 w-3" strokeWidth={1.75} />
                      {formatRelative(p.lastHealthCheck ?? p.lastDiscovery)}
                    </span>
                    <span
                      className="flex items-center gap-1"
                      style={{ fontFamily: "var(--font-mono), monospace" }}
                    >
                      <Gauge className="h-3 w-3" strokeWidth={1.75} />
                      {typeof p.latencyMs === "number" && p.latencyMs > 0
                        ? `${p.latencyMs}ms`
                        : "—"}
                    </span>
                  </div>
                )}

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refreshProvider(p.shortId, p.id)}
                  disabled={isRefreshing}
                  className="h-9 gap-1.5 mt-auto rounded-full uppercase tracking-[0.1em] text-[10px] border-border bg-transparent hover:bg-accent hover:text-white hover:border-accent transition-all"
                  style={{ fontFamily: "var(--font-mono), monospace" }}
                >
                  {isRefreshing ? (
                    <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.75} />
                  ) : (
                    <RefreshCw className="h-3 w-3" strokeWidth={1.75} />
                  )}
                  Refresh {p.shortId}
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {!loading && providers.length === 0 && !error && (
        <div className="text-center py-8 text-sm text-muted-foreground">
          No providers registered.
        </div>
      )}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// SyncStatusBar — global sync state banner (PRD §45).
//
// Shows "↻ Syncing all providers…" while the unified-registry sync is running,
// then briefly flashes the diff result ("✓ Synced — N new · M removed") for
// 3 seconds before fading back to idle.

interface SyncStatusBarProps {
  sync: {
    syncing: boolean;
    lastSyncAt: string | null;
    result: {
      added: number;
      updated: number;
      removed: number;
      free: number;
    } | null;
    error: string | null;
  };
}

function SyncStatusBar({ sync }: SyncStatusBarProps) {
  const [showFlash, setShowFlash] = React.useState(false);
  const lastResultRef = React.useRef<SyncStatusBarProps["sync"]["result"]>(null);
  React.useEffect(() => {
    if (sync.result && sync.result !== lastResultRef.current) {
      lastResultRef.current = sync.result;
      setShowFlash(true);
      const t = window.setTimeout(() => setShowFlash(false), 3000);
      return () => window.clearTimeout(t);
    }
    return;
  }, [sync.result]);

  const syncing = sync.syncing;
  const diff = sync.result;

  if (!syncing && !showFlash && !sync.error) {
    return null; // idle — no banner shown
  }

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-xl border border-accent/20 bg-accent/5 text-accent"
      role="status"
      aria-live="polite"
    >
      {syncing ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
          <span
            className="text-[10px] uppercase tracking-[0.12em]"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            ↻ Syncing all providers…
          </span>
        </>
      ) : sync.error ? (
        <>
          <AlertTriangle className="h-3.5 w-3.5 text-rose-500" strokeWidth={1.75} />
          <span
            className="text-[10px] uppercase tracking-[0.12em] text-rose-500"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            Sync failed: {sync.error}
          </span>
        </>
      ) : showFlash && diff ? (
        <>
          <Check className="h-3.5 w-3.5" strokeWidth={1.75} />
          <span
            className="text-[10px] uppercase tracking-[0.12em]"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            ✓ Synced — {diff.added} new · {diff.updated} updated ·{" "}
            {diff.removed} removed · {diff.free} free
          </span>
        </>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: typeof Server;
}) {
  return (
    <div className="rounded-lg border border-border bg-background px-2 py-1.5">
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-[0.15em] text-muted-foreground">
        <Icon className="h-2.5 w-2.5" strokeWidth={1.75} />
        {label}
      </div>
      <div
        className="text-base font-bold mt-0.5 text-foreground"
        style={{ fontFamily: "var(--font-mono), monospace" }}
      >
        {value}
      </div>
    </div>
  );
}

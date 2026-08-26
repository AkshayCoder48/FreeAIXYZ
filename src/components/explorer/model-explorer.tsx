"use client";

/**
 * ModelExplorer — interactive catalog UI (PRD §51, §52, §104, §105).
 *
 * Fetches the extended model catalog from `/api/models` on mount + on manual
 * refresh click. Renders a search box (PRD §197), a filter sidebar
 * (provider multi-select, capability toggles, status toggle — PRD §54), a
 * stale-catalog banner (PRD §172), an "updated Xs ago" indicator (PRD §114),
 * and a paginated "load more" model-card list (PRD §196 — handles 80+ models).
 *
 * Refresh-models button triggers POST /api/discovery/refresh (PRD §113).
 *
 * Styled per Minimalist Modern design system: search input with
 * `h-12 ring-2 ring-accent ring-offset-2` on focus, filter checkboxes as
 * gradient-tinted pills, model cards with gradient-border on hover,
 * `max-h-96 overflow-y-auto` with custom scrollbar.
 */

import * as React from "react";
import {
  RefreshCw,
  Search,
  AlertTriangle,
  Cpu,
  Eye,
  Wrench,
  Zap,
  Image as ImageIcon,
  Volume2,
  Server,
  Loader2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ModelCard } from "@/components/explorer/model-card";
import { cn } from "@/lib/utils";
import type { DiscoveredModel } from "@/lib/gateway";

interface CatalogResponse {
  lastUpdated: string;
  catalogStale: boolean;
  models: DiscoveredModel[];
}

interface ProviderEntry {
  id: string;
  shortId: string;
  name: string;
  status: string;
  models: number;
  streamingModels: number;
  imageModels: number;
  latencyMs?: number;
  lastHealthCheck?: string;
}

interface ProvidersResponse {
  providers: ProviderEntry[];
}

type CapFilter = "streaming" | "vision" | "tools" | "image" | "audio";
type StatusFilter = "active" | "degraded" | "offline";

interface CapMeta {
  label: string;
  icon: typeof Zap;
}

const CAP_FILTER_META: Record<CapFilter, CapMeta> = {
  streaming: { label: "STREAM", icon: Zap },
  vision: { label: "VISION", icon: Eye },
  tools: { label: "TOOLS", icon: Wrench },
  image: { label: "IMAGE", icon: ImageIcon },
  audio: { label: "AUDIO", icon: Volume2 },
};

function formatUpdated(iso?: string): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const diff = Date.now() - t;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}s ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function hasCap(m: DiscoveredModel, k: CapFilter): boolean {
  switch (k) {
    case "streaming":
      return Boolean(m.capabilities.streaming);
    case "vision":
      return Boolean(m.capabilities.vision);
    case "tools":
      return Boolean(m.capabilities.tools);
    case "image":
      return Boolean(m.capabilities.image);
    case "audio":
      return Boolean(m.capabilities.audioInput || m.capabilities.audioOutput);
  }
}

export function ModelExplorer() {
  const [catalog, setCatalog] = React.useState<CatalogResponse | null>(null);
  const [providers, setProviders] = React.useState<ProviderEntry[]>([]);
  const [loading, setLoading] = React.useState<boolean>(true);
  const [error, setError] = React.useState<string | null>(null);
  const [refreshing, setRefreshing] = React.useState<boolean>(false);
  const [refreshError, setRefreshError] = React.useState<string | null>(null);

  const [query, setQuery] = React.useState<string>("");
  const [providerSel, setProviderSel] = React.useState<Set<string>>(new Set());
  const [capsSel, setCapsSel] = React.useState<Set<CapFilter>>(new Set());
  const [statusSel, setStatusSel] = React.useState<Set<StatusFilter>>(
    new Set(["active", "degraded"]),
  );
  const [visibleCount, setVisibleCount] = React.useState<number>(50);
  const [now, setNow] = React.useState<number>(Date.now());

  // Tick once per 10s for relative-time freshness.
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(id);
  }, []);

  const loadCatalog = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/models", { cache: "no-store" });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `Failed to load catalog (HTTP ${res.status})${text ? `: ${text.slice(0, 200)}` : ""}`,
        );
      }
      const json = (await res.json()) as CatalogResponse;
      setCatalog(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadProviders = React.useCallback(async () => {
    try {
      const res = await fetch("/api/providers", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as ProvidersResponse;
      setProviders(json.providers ?? []);
    } catch {
      // Silent — providers are an enhancement, not a blocker.
    }
  }, []);

  React.useEffect(() => {
    loadCatalog();
    loadProviders();
  }, [loadCatalog, loadProviders]);

  const handleRefresh = React.useCallback(async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const res = await fetch("/api/discovery/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `Refresh failed (HTTP ${res.status})${text ? `: ${text.slice(0, 200)}` : ""}`,
        );
      }
      await loadCatalog();
      await loadProviders();
    } catch (e) {
      setRefreshError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }, [loadCatalog, loadProviders]);

  const handleRefreshProvider = React.useCallback(
    async (shortId: string) => {
      setRefreshing(true);
      setRefreshError(null);
      try {
        const res = await fetch("/api/discovery/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: shortId }),
        });
        if (!res.ok) {
          throw new Error(`Refresh ${shortId} failed (HTTP ${res.status})`);
        }
        await loadCatalog();
        await loadProviders();
      } catch (e) {
        setRefreshError(e instanceof Error ? e.message : String(e));
      } finally {
        setRefreshing(false);
      }
    },
    [loadCatalog, loadProviders],
  );

  const filtered = React.useMemo<DiscoveredModel[]>(() => {
    if (!catalog?.models) return [];
    const q = query.toLowerCase().trim();
    return catalog.models.filter((m) => {
      if (statusSel.size > 0 && !statusSel.has(m.status as StatusFilter)) {
        return false;
      }
      if (providerSel.size > 0 && !providerSel.has(m.providerId)) {
        return false;
      }
      if (capsSel.size > 0) {
        for (const c of capsSel) {
          if (!hasCap(m, c)) return false;
        }
      }
      if (!q) return true;
      return (
        m.id.toLowerCase().includes(q) ||
        m.name.toLowerCase().includes(q) ||
        m.upstreamId.toLowerCase().includes(q) ||
        m.providerId.toLowerCase().includes(q) ||
        m.providerName.toLowerCase().includes(q)
      );
    });
  }, [catalog, query, providerSel, capsSel, statusSel]);

  // Reset pagination when filters change.
  React.useEffect(() => {
    setVisibleCount(50);
  }, [query, providerSel, capsSel, statusSel]);

  const visible = filtered.slice(0, visibleCount);

  const providerEntries = React.useMemo(() => providers, [providers]);

  const totalStreaming = catalog
    ? catalog.models.filter((m) => m.capabilities.streaming).length
    : 0;

  return (
    <div className="grid lg:grid-cols-[260px_1fr] gap-6">
      {/* Sidebar */}
      <aside className="lg:sticky lg:top-20 lg:self-start space-y-4">
        {/* Search — focus ring per spec */}
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search models…"
            className="pl-10 h-12 bg-background border-border rounded-xl focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:border-accent"
            style={{ fontFamily: "var(--font-mono), monospace" }}
            aria-label="Search models"
          />
        </div>

        {/* Provider multi-select — gradient-tinted pills */}
        <FilterCard
          icon={Server}
          title={`Providers (${providerEntries.length})`}
        >
          <ScrollArea className="max-h-72 pr-2 custom-scroll">
            <div className="space-y-1.5">
              {providerEntries.length === 0 && (
                <div className="text-[11px] text-muted-foreground">
                  No providers loaded.
                </div>
              )}
              {providerEntries.map((p) => {
                const checked = providerSel.has(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setProviderSel((prev) => {
                        const next = new Set(prev);
                        if (checked) next.delete(p.id);
                        else next.add(p.id);
                        return next;
                      });
                    }}
                    className={cn(
                      "w-full min-w-0 flex items-center gap-2 cursor-pointer text-xs rounded-full px-3 py-1.5 transition-all",
                      checked
                        ? "bg-gradient-to-r from-accent/15 to-accent-secondary/15 border border-accent/40 text-foreground"
                        : "border border-border text-muted-foreground hover:text-foreground hover:border-accent/30",
                    )}
                    style={{ fontFamily: "var(--font-mono), monospace" }}
                  >
                    <span
                      className={cn(
                        "inline-flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border shrink-0",
                        checked
                          ? "bg-accent border-accent text-white"
                          : "border-border",
                      )}
                    >
                      {checked && (
                        <svg
                          className="h-2.5 w-2.5"
                          viewBox="0 0 12 12"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M2.5 6.5l2.5 2.5 4.5-5" />
                        </svg>
                      )}
                    </span>
                    <span
                      className="truncate flex-1 min-w-0 text-left overflow-hidden text-ellipsis whitespace-nowrap"
                      title={p.name}
                    >
                      {p.name}
                    </span>
                    <span
                      className={cn(
                        "text-[9px] uppercase tracking-wider shrink-0",
                        checked ? "text-accent" : "text-muted-foreground/70",
                      )}
                    >
                      {p.shortId}
                    </span>
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        </FilterCard>

        {/* Capabilities — gradient-tinted pills */}
        <FilterCard icon={Cpu} title="Capabilities">
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(CAP_FILTER_META) as CapFilter[]).map((c) => {
              const meta = CAP_FILTER_META[c];
              const checked = capsSel.has(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    setCapsSel((prev) => {
                      const next = new Set(prev);
                      if (checked) next.delete(c);
                      else next.add(c);
                      return next;
                    });
                  }}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-medium uppercase tracking-[0.1em] transition-all",
                    checked
                      ? "bg-gradient-to-r from-accent to-accent-secondary text-white border border-accent shadow-accent"
                      : "border border-border text-muted-foreground hover:text-foreground hover:border-accent/40",
                  )}
                  style={{ fontFamily: "var(--font-mono), monospace" }}
                >
                  <meta.icon className="h-3 w-3" strokeWidth={1.75} />
                  {meta.label}
                </button>
              );
            })}
          </div>
        </FilterCard>

        {/* Status */}
        <FilterCard icon={Zap} title="Status">
          <div className="flex flex-wrap gap-1.5">
            {(["active", "degraded", "offline"] as StatusFilter[]).map((s) => {
              const checked = statusSel.has(s);
              const dotClass =
                s === "active"
                  ? "bg-emerald-500"
                  : s === "degraded"
                    ? "bg-amber-500"
                    : "bg-rose-500";
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setStatusSel((prev) => {
                      const next = new Set(prev);
                      if (checked) next.delete(s);
                      else next.add(s);
                      return next;
                    });
                  }}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-medium uppercase tracking-[0.1em] transition-all",
                    checked
                      ? "bg-accent/10 border border-accent/40 text-foreground"
                      : "border border-border text-muted-foreground hover:text-foreground hover:border-accent/30",
                  )}
                  style={{ fontFamily: "var(--font-mono), monospace" }}
                >
                  <span className={cn("inline-block h-1.5 w-1.5 rounded-full", dotClass)} />
                  {s}
                </button>
              );
            })}
          </div>
        </FilterCard>
      </aside>

      {/* Results */}
      <section className="space-y-4 min-w-0">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span
              className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-1 text-accent"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent animate-pulse-dot" />
              {filtered.length} model{filtered.length === 1 ? "" : "s"}
            </span>
            <span
              className="rounded-full bg-muted px-2.5 py-1"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >
              {totalStreaming} streaming
            </span>
            <span
              className="hidden sm:inline-flex rounded-full bg-muted px-2.5 py-1"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >
              updated {formatUpdated(catalog?.lastUpdated)} (tick{" "}
              {Math.floor((Date.now() - now) / 1000)}s)
            </span>
          </div>
          <Button
            onClick={handleRefresh}
            disabled={refreshing}
            className="h-10 gap-2 bg-gradient-to-r from-[#0052FF] to-[#4D7CFF] text-white hover:shadow-accent rounded-full px-4 text-xs uppercase tracking-[0.1em] transition-all hover:-translate-y-0.5"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            {refreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
            ) : (
              <RefreshCw className="h-4 w-4" strokeWidth={1.75} />
            )}
            Refresh models
          </Button>
        </div>

        {/* Stale banner */}
        {catalog?.catalogStale && (
          <Alert className="border-amber-500/40 bg-amber-50 text-foreground rounded-xl">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <AlertTitle className="text-amber-700 dark:text-amber-500">
              Catalog is stale
            </AlertTitle>
            <AlertDescription>
              The last discovery run is older than the staleness threshold.
              Click &ldquo;Refresh models&rdquo; to re-discover all providers
              in parallel.
            </AlertDescription>
          </Alert>
        )}

        {/* Errors */}
        {error && (
          <Alert
            variant="destructive"
            className="rounded-xl"
          >
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Failed to load catalog</AlertTitle>
            <AlertDescription>
              {error}
              <Button
                variant="outline"
                size="sm"
                className="mt-2 ml-2 h-8 rounded-full"
                onClick={loadCatalog}
              >
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {refreshError && (
          <Alert className="rounded-xl">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Refresh error: {refreshError}
            </AlertDescription>
          </Alert>
        )}

        {/* Skeletons */}
        {loading && (
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {Array.from({ length: 9 }).map((_, i) => (
              <Skeleton key={i} className="h-40 w-full rounded-xl" />
            ))}
          </div>
        )}

        {/* Cards grid — scrollable area with custom scrollbar */}
        {!loading && !error && (
          <>
            <div className="max-h-[calc(100vh-280px)] overflow-y-auto pr-1 custom-scroll">
              <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {visible.map((m) => {
                  const providerEntry = providers.find(
                    (p) => p.id === m.providerId,
                  );
                  return (
                    <ModelCard
                      key={m.id}
                      model={m}
                      latencyMs={providerEntry?.latencyMs}
                    />
                  );
                })}
              </div>

              {visible.length === 0 && (
                <div className="text-center py-16 text-sm text-muted-foreground">
                  No models match the current filters.
                </div>
              )}
            </div>

            {visible.length < filtered.length && (
              <div className="flex justify-center pt-4">
                <Button
                  variant="outline"
                  onClick={() => setVisibleCount((c) => c + 50)}
                  className="h-10 gap-2 border-accent text-accent hover:bg-accent hover:text-white rounded-full uppercase tracking-[0.1em] text-xs"
                  style={{ fontFamily: "var(--font-mono), monospace" }}
                >
                  Load more ({filtered.length - visible.length} remaining)
                </Button>
              </div>
            )}
          </>
        )}

        {/* Per-provider refresh list (compact) */}
        {!loading && providers.length > 0 && (
          <div className="mt-8 rounded-xl border border-border bg-card p-4">
            <div
              className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground mb-3 flex items-center gap-1.5"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >
              <Server className="h-3 w-3" strokeWidth={1.75} />
              Per-provider refresh
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {providers.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2 transition-colors hover:border-accent/30"
                >
                  <div className="min-w-0 flex-1">
                    <div
                      className="text-xs font-medium truncate overflow-hidden text-ellipsis whitespace-nowrap"
                      title={p.name}
                      style={{ fontFamily: "var(--font-mono), monospace" }}
                    >
                      {p.name}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {p.models} models · {p.streamingModels} streaming
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRefreshProvider(p.shortId)}
                    disabled={refreshing}
                    className="h-8 gap-1.5 text-[10px] uppercase tracking-[0.1em] rounded-full hover:bg-accent/10 hover:text-accent"
                    style={{ fontFamily: "var(--font-mono), monospace" }}
                  >
                    <RefreshCw
                      className={cn("h-3 w-3", refreshing && "animate-spin")}
                      strokeWidth={1.75}
                    />
                    {p.shortId}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * FilterCard — small card wrapper used for the sidebar filter groups.
 * Lighter than the previous "border-foreground" approach; uses border-border
 * + rounded-xl to match the Minimalist Modern aesthetic.
 */
function FilterCard({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Server;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
      <div
        className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground mb-2.5 flex items-center gap-1.5"
        style={{ fontFamily: "var(--font-mono), monospace" }}
      >
        <Icon className="h-3 w-3" strokeWidth={1.75} />
        {title}
      </div>
      {children}
    </div>
  );
}

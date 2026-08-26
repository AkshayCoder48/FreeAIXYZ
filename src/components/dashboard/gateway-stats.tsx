"use client";

/**
 * GatewayStats — admin/debug metrics snapshot (PRD §102, §115, §116, §117).
 *
 * Polls /api/metrics every 10 seconds (PRD §115 — auto-refresh). Renders
 * summary cards (requests, success rate, errors, streaming requests, avg
 * TTFT, avg latency, provider failures) and a recent-errors table (last 10).
 *
 * Styled per Minimalist Modern design: rounded-xl cards, accent on numbers,
 * gradient success indicator.
 */

import * as React from "react";
import {
  Activity,
  CheckCircle2,
  AlertOctagon,
  Zap,
  Gauge,
  Clock,
  ServerCrash,
  RefreshCw,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface ApiMetrics {
  requests: number;
  successRate: number;
  errors: number;
  streamingRequests: number;
  averageTtftMs: number;
  averageLatencyMs: number;
  providerFailures: Record<string, number>;
  recentErrors: Array<{
    requestId: string;
    providerId?: string;
    modelId?: string;
    status: number;
    type: string;
    message: string;
    at: string;
  }>;
}

interface MetricsResponse {
  metrics: ApiMetrics;
  streamTimings: unknown[];
}

function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatPct(p: number): string {
  if (!Number.isFinite(p)) return "—";
  return `${(p * 100).toFixed(1)}%`;
}

function formatRelative(iso?: string): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const diff = Date.now() - t;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

interface GatewayStatsProps {
  /** Compact: hide the recent-errors table (for landing page embeds). */
  compact?: boolean;
  /** Polling interval in ms. Default 10_000. */
  intervalMs?: number;
}

export function GatewayStats({ compact, intervalMs = 10_000 }: GatewayStatsProps) {
  const [metrics, setMetrics] = React.useState<ApiMetrics | null>(null);
  const [loading, setLoading] = React.useState<boolean>(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/metrics", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Metrics load failed (HTTP ${res.status})`);
      }
      const json = (await res.json()) as MetricsResponse;
      setMetrics(json.metrics);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
    const id = window.setInterval(load, intervalMs);
    return () => window.clearInterval(id);
  }, [load, intervalMs]);

  if (loading && !metrics) {
    return (
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (error && !metrics) {
    return (
      <Alert className="rounded-xl">
        <AlertDescription className="text-xs">
          Metrics unavailable: {error}
        </AlertDescription>
      </Alert>
    );
  }

  const stats = metrics ?? {
    requests: 0,
    successRate: 0,
    errors: 0,
    streamingRequests: 0,
    averageTtftMs: 0,
    averageLatencyMs: 0,
    providerFailures: {} as Record<string, number>,
    recentErrors: [],
  };

  const failureEntries = Object.entries(stats.providerFailures)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const cards = [
    {
      label: "Total requests",
      value: String(stats.requests),
      icon: Activity,
      hint: `${stats.streamingRequests} streaming`,
    },
    {
      label: "Success rate",
      value: formatPct(stats.successRate),
      icon: CheckCircle2,
      hint: `${stats.errors} errors`,
    },
    {
      label: "Avg TTFT",
      value: formatMs(stats.averageTtftMs),
      icon: Zap,
      hint: "time-to-first-token",
    },
    {
      label: "Avg latency",
      value: formatMs(stats.averageLatencyMs),
      icon: Clock,
      hint: "request → done",
    },
  ];

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg sm:text-xl font-semibold tracking-tight flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <Gauge className="h-4 w-4" strokeWidth={1.75} />
          </span>
          Gateway metrics
        </h3>
        <button
          type="button"
          onClick={load}
          className="h-9 px-3 inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] rounded-full border border-accent text-accent hover:bg-accent hover:text-white transition-all"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          <RefreshCw className="h-3 w-3" strokeWidth={1.75} />
          Refresh
        </button>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map((c) => (
          <Card
            key={c.label}
            className="rounded-xl border-border bg-card hover:border-accent/30 hover:shadow-accent transition-all"
          >
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle
                  className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-medium"
                  style={{ fontFamily: "var(--font-mono), monospace" }}
                >
                  {c.label}
                </CardTitle>
                <c.icon className="h-3 w-3 text-accent" strokeWidth={1.75} />
              </div>
            </CardHeader>
            <CardContent>
              <div
                className="text-2xl sm:text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-[#0052FF] to-[#4D7CFF]"
                style={{ fontFamily: "var(--font-mono), monospace" }}
              >
                {c.value}
              </div>
              <div
                className="text-[10px] text-muted-foreground mt-1"
                style={{ fontFamily: "var(--font-mono), monospace" }}
              >
                {c.hint}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {failureEntries.length > 0 && (
        <Card className="rounded-xl border-border">
          <CardHeader className="pb-2">
            <CardTitle
              className="text-[10px] uppercase tracking-[0.15em] flex items-center gap-2 text-muted-foreground"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >
              <ServerCrash className="h-3 w-3" strokeWidth={1.75} />
              Provider failures (top 5)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {failureEntries.map(([provider, count]) => (
                <span
                  key={provider}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] uppercase tracking-[0.1em] border border-border text-foreground"
                  style={{ fontFamily: "var(--font-mono), monospace" }}
                >
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-rose-500" />
                  {provider}: {count}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {!compact && (
        <Card className="rounded-xl border-border">
          <CardHeader className="pb-2">
            <CardTitle
              className="text-[10px] uppercase tracking-[0.15em] flex items-center gap-2 text-muted-foreground"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >
              <AlertOctagon className="h-3 w-3" strokeWidth={1.75} />
              Recent errors (last 10)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats.recentErrors.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4">
                No recent errors. The gateway is healthy.
              </p>
            ) : (
              <ScrollArea className="max-h-72 custom-scroll">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border">
                      <TableHead
                        className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground h-9"
                        style={{ fontFamily: "var(--font-mono), monospace" }}
                      >
                        Request
                      </TableHead>
                      <TableHead
                        className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground h-9"
                        style={{ fontFamily: "var(--font-mono), monospace" }}
                      >
                        Provider / Model
                      </TableHead>
                      <TableHead
                        className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground h-9"
                        style={{ fontFamily: "var(--font-mono), monospace" }}
                      >
                        Status
                      </TableHead>
                      <TableHead
                        className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground h-9"
                        style={{ fontFamily: "var(--font-mono), monospace" }}
                      >
                        Type / Message
                      </TableHead>
                      <TableHead
                        className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground h-9 text-right"
                        style={{ fontFamily: "var(--font-mono), monospace" }}
                      >
                        At
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stats.recentErrors.map((e, i) => (
                      <TableRow
                        key={`${e.requestId}-${i}`}
                        className={cn("border-border/60")}
                      >
                        <TableCell
                          className="text-[10px] py-2 break-all max-w-32"
                          style={{ fontFamily: "var(--font-mono), monospace" }}
                        >
                          {e.requestId}
                        </TableCell>
                        <TableCell
                          className="text-[10px] py-2 max-w-48"
                          style={{ fontFamily: "var(--font-mono), monospace" }}
                        >
                          {e.providerId ?? "—"}
                          {e.modelId && (
                            <span className="block text-muted-foreground break-all">
                              {e.modelId}
                            </span>
                          )}
                        </TableCell>
                        <TableCell
                          className="text-[10px] py-2"
                          style={{ fontFamily: "var(--font-mono), monospace" }}
                        >
                          <span
                            className={cn(
                              "inline-block h-1.5 w-1.5 rounded-full mr-1.5 align-middle",
                              e.status >= 500
                                ? "bg-rose-500"
                                : e.status >= 400
                                  ? "bg-amber-500"
                                  : "bg-muted-foreground/40",
                            )}
                          />
                          {e.status}
                        </TableCell>
                        <TableCell
                          className="text-[10px] py-2 max-w-64"
                          style={{ fontFamily: "var(--font-mono), monospace" }}
                        >
                          <span className="text-foreground">{e.type}</span>
                          <span className="block text-muted-foreground break-words line-clamp-2">
                            {e.message}
                          </span>
                        </TableCell>
                        <TableCell
                          className="text-[10px] py-2 text-right text-muted-foreground whitespace-nowrap"
                          style={{ fontFamily: "var(--font-mono), monospace" }}
                        >
                          {formatRelative(e.at)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      )}
    </section>
  );
}

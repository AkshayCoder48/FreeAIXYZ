"use client";

/**
 * LiveStatsBar — KPI row rendered inside an InvertedSection on the landing page.
 *
 * Fetches /api/metrics + /api/providers on mount and every 10s. Renders 4 KPIs
 * with gradient accent on the numbers:
 *   - Providers count
 *   - Models count
 *   - Avg TTFT
 *   - Uptime (computed from success rate)
 */
import * as React from "react";
import { motion } from "framer-motion";
import { Server, Cpu, Zap, Activity } from "lucide-react";

interface ApiMetrics {
  requests: number;
  successRate: number;
  errors: number;
  streamingRequests: number;
  averageTtftMs: number;
  averageLatencyMs: number;
}

interface MetricsResponse {
  metrics: ApiMetrics;
  streamTimings: unknown[];
}

interface ProviderEntry {
  id: string;
  shortId: string;
  name: string;
  status: string;
  models: number;
}

interface ProvidersResponse {
  providers: ProviderEntry[];
}

function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms <= 0)
    return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatPct(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return "100.0";
  return `${(p * 100).toFixed(1)}`;
}

interface Stat {
  label: string;
  value: string;
  icon: typeof Server;
  hint?: string;
}

export function LiveStatsBar() {
  const [metrics, setMetrics] = React.useState<ApiMetrics | null>(null);
  const [providers, setProviders] = React.useState<ProviderEntry[]>([]);
  const [error, setError] = React.useState<boolean>(false);

  const loadAll = React.useCallback(async () => {
    try {
      const [mRes, pRes] = await Promise.allSettled([
        fetch("/api/metrics", { cache: "no-store" }),
        fetch("/api/providers", { cache: "no-store" }),
      ]);
      if (mRes.status === "fulfilled" && mRes.value.ok) {
        const j = (await mRes.value.json()) as MetricsResponse;
        setMetrics(j.metrics);
      }
      if (pRes.status === "fulfilled" && pRes.value.ok) {
        const j = (await pRes.value.json()) as ProvidersResponse;
        setProviders(j.providers ?? []);
      }
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  React.useEffect(() => {
    loadAll();
    const id = window.setInterval(loadAll, 10_000);
    return () => window.clearInterval(id);
  }, [loadAll]);

  const totalModels = React.useMemo(
    () => providers.reduce((sum, p) => sum + (p.models ?? 0), 0),
    [providers],
  );

  const stats: Stat[] = [
    {
      label: "Providers",
      value: String(providers.length || "—"),
      icon: Server,
      hint: "live adapters",
    },
    {
      label: "Models",
      value: String(totalModels || "—"),
      icon: Cpu,
      hint: "canonical ids",
    },
    {
      label: "Avg TTFT",
      value: formatMs(metrics?.averageTtftMs),
      icon: Zap,
      hint: "time to first token",
    },
    {
      label: "Uptime",
      value: `${formatPct(metrics?.successRate)}%`,
      icon: Activity,
      hint: `${metrics?.requests ?? 0} reqs`,
    },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-12 sm:py-16">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-8">
        {stats.map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.15, margin: "-60px" }}
            transition={{
              duration: 0.5,
              delay: i * 0.08,
              ease: [0.16, 1, 0.3, 1],
            }}
            className="flex flex-col"
          >
            <div className="flex items-center gap-2 text-white/60 mb-2">
              <s.icon className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span
                className="text-[10px] font-medium uppercase tracking-[0.15em]"
                style={{ fontFamily: "var(--font-mono), monospace" }}
              >
                {s.label}
              </span>
            </div>
            <div
              className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white via-[#4D7CFF] to-[#0052FF]"
              style={{ fontFamily: "var(--font-display), Georgia, serif" }}
            >
              {s.value}
            </div>
            {s.hint && (
              <div
                className="text-[10px] text-white/40 mt-1"
                style={{ fontFamily: "var(--font-mono), monospace" }}
              >
                {s.hint}
              </div>
            )}
          </motion.div>
        ))}
      </div>
      {error && (
        <p
          className="text-center text-[11px] text-white/40 mt-6"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          metrics unavailable — try /api/metrics directly
        </p>
      )}
    </div>
  );
}

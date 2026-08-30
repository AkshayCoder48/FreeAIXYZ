"use client";

/**
 * PricingBoard — unified per-model pricing surface (PRD §23, §26, §30, §58).
 *
 * GET /api/v1/pricing → { version, currency, multiplier, referenceRequest,
 *   updatedAt, models: Record<id, { inputPerMillion, outputPerMillion,
 *   cachePerMillion, currency, status, source, verifiedAt }> }
 *
 * DISPLAY RULES (PRD §26):
 *   - $0 with status "free"               → emerald "Free" badge + "$0.00 / 1M"
 *   - null with status "not_documented"   → amber "Not documented" badge + "—"
 *     (NEVER show "$0" for not_documented).
 *   - status "documented" → green
 *   - status "supplied"    → blue (we map to slate to avoid indigo/blue per spec)
 *
 * Source filter is inferred from the model id namespace (PRD §18):
 *   <id>           → NATIVE
 *   gratisfy/<...> → GRATISFY
 *   g4f/<...>      → G4F
 *
 * Source badges: NATIVE=slate, GRATISFY=violet, G4F=orange.
 */

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type PricingStatus =
  | "documented"
  | "supplied"
  | "estimated"
  | "free"
  | "not_documented";

interface ModelPricing {
  inputPerMillion: number | null;
  outputPerMillion: number | null;
  cachePerMillion?: number | null;
  currency: "USD";
  status: PricingStatus;
  source: string;
  verifiedAt?: string;
}

interface PricingResponse {
  version: number;
  currency: "USD";
  multiplier: number;
  referenceRequest: { inputTokens: number; outputTokens: number };
  updatedAt: string;
  models: Record<string, ModelPricing>;
}

type SourceFilter = "all" | "native" | "gratisfy" | "g4f";
type StatusFilter = "all" | "free" | "paid" | "documented" | "not_documented";

function inferSource(id: string): SourceFilter {
  if (id.startsWith("gratisfy/") || id.startsWith("gratisfy:")) return "gratisfy";
  if (id.startsWith("g4f/") || id.startsWith("g4f:")) return "g4f";
  return "native";
}

function SourceBadge({ source }: { source: SourceFilter }) {
  if (source === "gratisfy") {
    return (
      <Badge className="border-transparent bg-violet-500/15 text-violet-700 dark:text-violet-300">
        GRATISFY
      </Badge>
    );
  }
  if (source === "g4f") {
    return (
      <Badge className="border-transparent bg-orange-500/15 text-orange-700 dark:text-orange-300">
        G4F
      </Badge>
    );
  }
  return (
    <Badge className="border-transparent bg-slate-500/15 text-slate-700 dark:text-slate-300">
      NATIVE
    </Badge>
  );
}

function StatusBadge({ status }: { status: PricingStatus }) {
  switch (status) {
    case "documented":
      return (
        <Badge className="border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
          Documented
        </Badge>
      );
    case "free":
      return (
        <Badge className="border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
          Free
        </Badge>
      );
    case "supplied":
      return (
        <Badge className="border-transparent bg-slate-500/15 text-slate-700 dark:text-slate-300">
          Supplied
        </Badge>
      );
    case "estimated":
      return (
        <Badge className="border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-300">
          Estimated
        </Badge>
      );
    case "not_documented":
      return (
        <Badge className="border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-300">
          Not documented
        </Badge>
      );
    default:
      return null;
  }
}

function formatUsd(perMillion: number | null): string {
  if (perMillion === null) return "—";
  return `$${perMillion.toFixed(2)} / 1M`;
}

function matchesStatus(
  pricing: ModelPricing,
  filter: StatusFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "free") return pricing.status === "free";
  if (filter === "documented") return pricing.status === "documented";
  if (filter === "not_documented") return pricing.status === "not_documented";
  if (filter === "paid") {
    // anything with a non-null, non-zero price
    return (
      pricing.status !== "free" &&
      pricing.status !== "not_documented" &&
      (pricing.inputPerMillion !== null || pricing.outputPerMillion !== null)
    );
  }
  return true;
}

export function PricingBoard() {
  const [data, setData] = useState<PricingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/pricing", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const json: PricingResponse = await res.json();
        if (!cancelled) setData(json);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    const entries = Object.entries(data.models).map(([id, pricing]) => ({
      id,
      pricing,
      source: inferSource(id),
    }));
    const filtered = entries.filter(({ id, pricing, source }) => {
      if (sourceFilter !== "all" && source !== sourceFilter) return false;
      if (!matchesStatus(pricing, statusFilter)) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        if (!id.toLowerCase().includes(q)) return false;
      }
      return true;
    });
    filtered.sort((a, b) => a.id.localeCompare(b.id));
    return filtered;
  }, [data, sourceFilter, statusFilter, search]);

  const totalModels = data ? Object.keys(data.models).length : 0;
  const cappedRows = rows.slice(0, 300);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Pricing board</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          One authoritative per-model USD price. &ldquo;$0&rdquo; means
          explicitly free; &ldquo;—&rdquo; means we could not establish a
          reliable price (never show $0 for the unknown case).
        </p>
      </div>

      {loading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : data ? (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline" className="font-mono">
              v{data.version}
            </Badge>
            <Badge variant="outline">USD</Badge>
            <Badge variant="outline">
              XYZ→USD multiplier ×{data.multiplier}
            </Badge>
            <Badge variant="outline" className="font-mono">
              ref {data.referenceRequest.inputTokens} in /{" "}
              {data.referenceRequest.outputTokens} out
            </Badge>
            <span className="text-muted-foreground">
              updated {new Date(data.updatedAt).toLocaleString()}
            </span>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Tabs
              value={sourceFilter}
              onValueChange={(v) => setSourceFilter(v as SourceFilter)}
            >
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="native">Native</TabsTrigger>
                <TabsTrigger value="gratisfy">Gratisfy</TabsTrigger>
                <TabsTrigger value="g4f">G4F</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search model…"
                className="pl-8"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-1">
            {(
              [
                "all",
                "free",
                "paid",
                "documented",
                "not_documented",
              ] as StatusFilter[]
            ).map((s) => {
              const label =
                s === "all"
                  ? "All"
                  : s === "not_documented"
                    ? "Not documented"
                    : s.charAt(0).toUpperCase() + s.slice(1);
              const active = statusFilter === s;
              return (
                <Button
                  key={s}
                  size="sm"
                  variant={active ? "default" : "outline"}
                  onClick={() => setStatusFilter(s)}
                  className="capitalize"
                >
                  {label}
                </Button>
              );
            })}
          </div>

          <p className="text-xs text-muted-foreground">
            Showing {cappedRows.length} of {rows.length} matched (of{" "}
            {totalModels} total).
          </p>

          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead className="text-right">Input /1M</TableHead>
                  <TableHead className="text-right">Output /1M</TableHead>
                  <TableHead className="text-right">Cache /1M</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>XYZ est</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cappedRows.map(({ id, pricing, source }) => {
                  const providerShort =
                    id.split("/")[0]?.split(":")[0] ?? id;
                  return (
                    <TableRow key={id}>
                      <TableCell className="font-mono text-xs">{id}</TableCell>
                      <TableCell>
                        <SourceBadge source={source} />
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {providerShort}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatUsd(pricing.inputPerMillion)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatUsd(pricing.outputPerMillion)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatUsd(pricing.cachePerMillion ?? null)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={pricing.status} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        <span title="Estimated responses per XYZ varies with usage; see XYZ calc.">
                          ≈ varies
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {cappedRows.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="text-center text-sm text-muted-foreground py-6"
                    >
                      No models match the current filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Could not load pricing board. Try again later.
        </p>
      )}
    </div>
  );
}

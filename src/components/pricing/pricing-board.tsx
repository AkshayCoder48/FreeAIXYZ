"use client";

/**
 * PricingBoardClient — the interactive half of the /pricing page
 * (PRD §34, §35, §36, §37, §38, §62, §63).
 *
 * Receives pre-fetched pricing + capability data as props from the
 * Server Component (the RSC calls `getUnifiedModels()` + the supplied
 * pricing board directly — no HTTP round-trip to /api/v1/pricing from
 * inside an RSC, same pattern W4-B uses on the single-model page). The
 * client island owns ONLY the interactivity: filter chips, search box,
 * and the card grid render.
 *
 * Cards (PRD §63) show, top → bottom:
 *   1. Model display name (large, clickable → /models/<provider>/<id>)
 *   2. Provider sub-label + Pricing source badge
 *   3. Input / Output / Cache prices ($X.XX / 1M, "Free", or "—")
 *   4. ~Responses / XYZ (standardized 1k in / 1k out per PRD §41)
 *   5. Capability badges (Reasoning / Coding / Search / Vision / Chat)
 *
 * PRD §26 — NEVER show "$0" for the not-documented case. "Free" only
 * when pricing.status === "free"; "—" only when null/undocumented.
 */

import * as React from "react";
import Link from "next/link";
import { Search, AlertCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface PricingSourceLegendEntry {
  label: string;
  cls: string;
}

export interface PricingCardEntry {
  id: string;
  displayName: string;
  source: "native" | "gratisfy" | "g4f";
  provider: string;
  originalModelId: string;
  capabilities: {
    text: boolean;
    vision: boolean;
    audio: boolean;
    video: boolean;
    image: boolean;
    reasoning: boolean;
    webSearch: boolean;
    streaming: boolean;
    tools?: boolean;
  };
  pricing: {
    inputPerMillion: number | null;
    outputPerMillion: number | null;
    cachePerMillion?: number | null;
    currency: "USD" | "pollen";
    status: string;
    source: string;
    verifiedAt?: string;
  };
}

interface ModelCapabilitiesLite {
  text: boolean;
  vision: boolean;
  audio: boolean;
  video: boolean;
  image: boolean;
  reasoning: boolean;
  webSearch: boolean;
  streaming: boolean;
  tools?: boolean;
}

interface ModelPricingLite {
  inputPerMillion: number | null;
  outputPerMillion: number | null;
  cachePerMillion?: number | null;
  currency: "USD" | "pollen";
  status: string;
  source: string;
  verifiedAt?: string;
}

type FilterKey =
  | "all"
  | "free"
  | "low_cost"
  | "reasoning"
  | "coding"
  | "search"
  | "vision";

interface FilterMeta {
  key: FilterKey;
  label: string;
}

const FILTERS: FilterMeta[] = [
  { key: "all", label: "All" },
  { key: "free", label: "Free" },
  { key: "low_cost", label: "Low Cost" },
  { key: "reasoning", label: "Reasoning" },
  { key: "coding", label: "Coding" },
  { key: "search", label: "Search" },
  { key: "vision", label: "Vision" },
];

// ─── Helpers (matching the W4-A/W4-B visual language) ──────────────────────

/**
 * Pricing source badge. Provider=emerald, Market=slate, Manual=slate,
 * Undocumented=amber (PRD §26).
 */
function pricingSourceBadge(
  p: ModelPricingLite,
): { label: string; cls: string } {
  if (!isPricingDocumented(p)) {
    return {
      label: "Undocumented",
      cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
    };
  }
  if (p.source === "provider") {
    return {
      label: "Provider",
      cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
    };
  }
  if (p.source === "manual") {
    return {
      label: "Manual",
      cls: "bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/30",
    };
  }
  // pricing-board + unknown both surface as "Market" (the supplied
  // baseline represents the market-rate baseline — PRD §24).
  return {
    label: "Market",
    cls: "bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/30",
  };
}

function sourceBadgeCls(source: string): { label: string; cls: string } {
  // NATIVE=slate, GRATISFY=violet, G4F=orange. NO indigo / blue.
  if (source === "gratisfy") {
    return {
      label: "BYOK",
      cls: "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/30",
    };
  }
  if (source === "g4f") {
    return {
      label: "G4F",
      cls: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30",
    };
  }
  return {
    label: "Native",
    cls: "bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/30",
  };
}

function isPricingDocumented(p: ModelPricingLite | null | undefined): boolean {
  if (!p) return false;
  if (p.status === "not_documented") return false;
  if (p.inputPerMillion == null || p.outputPerMillion == null) return false;
  return true;
}

function isFree(p: ModelPricingLite | null | undefined): boolean {
  return Boolean(p && p.status === "free");
}

function formatPrice(v: number | null | undefined, currency: "USD" | "pollen" = "USD"): string {
  if (v == null) return "—";
  if (v === 0) return currency === "pollen" ? "0 pollen" : "$0";
  if (currency === "pollen") {
    if (v < 0.01) return `${v.toFixed(4)} pollen`;
    if (v < 1) return `${v.toFixed(3)} pollen`;
    return `${v.toFixed(2)} pollen`;
  }
  if (v < 0.01) return `$${v.toFixed(4)}`;
  if (v < 1) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(2)}`;
}

/**
 * Estimated responses per 1 XYZ for the standardized 1000-in / 1000-out /
 * 0-cache request (PRD §41). Returns:
 *   - { kind: "finite"; value: N }  when the model is paid + documented
 *   - { kind: "free" }              when the model is explicitly free
 *   - { kind: "unknown" }           when pricing is undocumented
 */
function responsesPerXYZ(
  p: ModelPricingLite | null | undefined,
  multiplier: number,
): { kind: "finite"; value: number } | { kind: "free" } | { kind: "unknown" } {
  if (!isPricingDocumented(p)) return { kind: "unknown" };
  if (p!.status === "free") return { kind: "free" };
  const input = p!.inputPerMillion ?? 0;
  const output = p!.outputPerMillion ?? 0;
  const usdCost = (1000 / 1e6) * input + (1000 / 1e6) * output;
  if (usdCost <= 0) return { kind: "free" };
  const denom = usdCost * (multiplier || 1);
  if (denom <= 0) return { kind: "unknown" };
  return { kind: "finite", value: Math.floor(1 / denom) };
}

/**
 * Heuristic capability detection from the model id. The registry currently
 * returns default capabilities (text=true, all others=false) for native +
 * g4f + gratisfy models, so without this the Reasoning / Coding / Search
 * / Vision filter chips would surface ~0 models. The heuristics below
 * pattern-match against well-known model family names that DO have those
 * capabilities. When the registry is later enriched with real per-model
 * capabilities, the heuristics become harmless no-ops (the OR falls
 * through to the real flag).
 */
function inferCapabilityFlags(
  entry: PricingCardEntry,
): { reasoning: boolean; coding: boolean; search: boolean; vision: boolean } {
  const id = `${entry.source}:${entry.provider}:${entry.originalModelId}`.toLowerCase();
  const caps = entry.capabilities as ModelCapabilitiesLite;
  return {
    reasoning:
      Boolean(caps.reasoning) ||
      /(reasoning|deepseek-r1|o3-mini|o4-mini|minimax-m3|nemotron-3-ultra|nemotron-3-super)/.test(
        id,
      ),
    coding:
      /(\bcode\b|codestral|cohere\/north-mini-code)/.test(id) ||
      // Codestral / North-mini-Code are explicitly code-focused; the bare
      // "code" token covers anything with "code" in the path segment.
      /\/[^/]*code[^/]*($|:|\/)/.test(id),
    search:
      Boolean(caps.webSearch) || /(search|perplexity)/.test(id),
    vision:
      Boolean(caps.vision) ||
      /(vision|gpt-4o|gpt-5|gpt-5\.2|claude|gemini-[23]|grok-4|llama-4|llava|internvl|qwen-?vl|qwen3-?vl)/.test(
        id,
      ),
  };
}

function capabilityBadges(entry: PricingCardEntry): string[] {
  const f = inferCapabilityFlags(entry);
  const out: string[] = [];
  if (f.reasoning) out.push("Reasoning");
  if (f.coding) out.push("Coding");
  if (f.search) out.push("Search");
  if (f.vision) out.push("Vision");
  if (out.length === 0) out.push("Chat");
  return out;
}

function shortModelName(entry: PricingCardEntry): string {
  const oid = entry.originalModelId || entry.displayName;
  const slash = oid.lastIndexOf("/");
  if (slash >= 0) return oid.slice(slash + 1);
  return entry.displayName || oid;
}

function providerSubLabel(entry: PricingCardEntry): string {
  if (entry.source === "native") return `Native · ${entry.provider}`;
  if (entry.source === "g4f") return `G4F · ${entry.provider}`;
  return `Gratisfy · ${entry.provider}`;
}

function modelHref(entry: PricingCardEntry): string {
  // /models/[provider]/[publicId URL-encoded] — W4-B builds the route.
  return `/models/${encodeURIComponent(entry.provider)}/${encodeURIComponent(entry.id)}`;
}

function totalPerMillion(p: ModelPricingLite): number {
  const i = p.inputPerMillion ?? 0;
  const o = p.outputPerMillion ?? 0;
  return i + o;
}

// ─── Top-level client island ───────────────────────────────────────────────

interface PricingBoardClientProps {
  entries: PricingCardEntry[];
  multiplier: number;
  referenceRequest: { inputTokens: number; outputTokens: number };
  boardVersion: number;
  updatedAt: string;
  sourceLegend: PricingSourceLegendEntry[];
}

export function PricingBoardClient({
  entries,
  multiplier,
  referenceRequest,
  boardVersion,
  updatedAt,
  sourceLegend,
}: PricingBoardClientProps) {
  const [filter, setFilter] = React.useState<FilterKey>("all");
  const [query, setQuery] = React.useState("");
  // Per-page pagination so the grid doesn't render thousands of cards at
  // once when the g4f aggregate is live (same pattern as the catalog).
  const [visibleCount, setVisibleCount] = React.useState(48);

  // Filtered + searched entries for the current state.
  const filtered = React.useMemo(() => {
    const q = query.toLowerCase().trim();
    return entries.filter((entry) => {
      if (!matchesFilter(entry, filter)) return false;
      if (q) {
        const hay = `${entry.id} ${entry.displayName} ${entry.originalModelId} ${entry.provider}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [entries, filter, query]);

  // Reset pagination when the filter / query changes.
  React.useEffect(() => {
    setVisibleCount(48);
  }, [filter, query]);

  const visible = filtered.slice(0, visibleCount);
  const remaining = filtered.length - visible.length;

  // Count per filter chip (so the user can see how many each will surface).
  const counts = React.useMemo(() => {
    const out: Record<FilterKey, number> = {
      all: entries.length,
      free: 0,
      low_cost: 0,
      reasoning: 0,
      coding: 0,
      search: 0,
      vision: 0,
    };
    for (const e of entries) {
      if (matchesFilter(e, "free")) out.free++;
      if (matchesFilter(e, "low_cost")) out.low_cost++;
      if (matchesFilter(e, "reasoning")) out.reasoning++;
      if (matchesFilter(e, "coding")) out.coding++;
      if (matchesFilter(e, "search")) out.search++;
      if (matchesFilter(e, "vision")) out.vision++;
    }
    return out;
  }, [entries]);

  return (
    <section className="flex flex-col gap-6 min-w-0" aria-label="Model pricing grid">
      {/* ─── Section header ─────────────────────────────────────────── */}
      <header className="flex flex-col gap-3 min-w-0">
        <div className="flex items-baseline justify-between gap-3 flex-wrap min-w-0">
          <h2
            className="text-xl sm:text-2xl font-normal tracking-tight text-foreground"
            style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
          >
            Model pricing
          </h2>
          <span
            className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            {filtered.length} shown · ref{" "}
            {referenceRequest.inputTokens.toLocaleString()} in /{" "}
            {referenceRequest.outputTokens.toLocaleString()} out
          </span>
        </div>

        {/* Search — w-full + min-w-0, never overflows the row */}
        <div className="relative w-full min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search models, ids, providers…"
            className="pl-9 h-11 rounded-lg"
            aria-label="Search pricing board"
          />
        </div>
      </header>

      {/* ─── Filter chips — wrap to next row on narrow viewports ──── */}
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        {FILTERS.map((f) => {
          const active = filter === f.key;
          const count = counts[f.key];
          return (
            <FilterChip
              key={f.key}
              active={active}
              onClick={() => setFilter(f.key)}
              label={f.label}
              count={count}
            />
          );
        })}
      </div>

      {/* ─── Cards grid (1 / 2 / 3 / 4 cols) ─────────────────────────── */}
      {visible.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 min-w-0">
          {visible.map((entry) => (
            <PricingCard
              key={entry.id}
              entry={entry}
              multiplier={multiplier}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-background/50 p-8 text-center text-sm text-muted-foreground min-w-0">
          No models match the current filters.
        </div>
      )}

      {/* ─── Pagination ─── */}
      {remaining > 0 && (
        <div className="flex justify-center pt-2 min-w-0">
          <button
            type="button"
            onClick={() => setVisibleCount((c) => c + 48)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs uppercase tracking-[0.1em] border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            Show {Math.min(48, remaining)} more · {remaining} hidden
          </button>
        </div>
      )}

      {/* ─── Last-updated timestamp + board version (mono) ──────── */}
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground min-w-0">
        <Badge variant="outline" className="font-mono h-5 text-[10px]">
          v{boardVersion}
        </Badge>
        <Badge variant="outline" className="h-5 text-[10px]">
          USD
        </Badge>
        <Badge variant="outline" className="h-5 text-[10px]">
          XYZ×{multiplier.toFixed(1)}
        </Badge>
        <span style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}>
          updated {new Date(updatedAt).toLocaleString()}
        </span>
      </div>

      {/* ─── Mobile legend — restate the source colors on small screens ─── */}
      <details className="sm:hidden min-w-0">
        <summary
          className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground cursor-pointer"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          Pricing source legend
        </summary>
        <div className="flex flex-col gap-2 mt-3 min-w-0">
          {sourceLegend.map((s) => (
            <div key={s.label} className="flex items-center gap-2 min-w-0">
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] uppercase tracking-wider px-2 py-0.5 h-5",
                  s.cls,
                )}
                style={{ fontFamily: "var(--font-mono), monospace" }}
              >
                {s.label}
              </Badge>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}

// ─── Filter chip ───────────────────────────────────────────────────────────

function FilterChip({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all border min-w-0 max-w-full",
        active
          ? "bg-foreground text-background border-foreground"
          : "bg-background text-muted-foreground border-border hover:text-foreground hover:border-foreground/30",
      )}
      style={{ fontFamily: "var(--font-mono), monospace" }}
    >
      <span className="truncate max-w-[160px] overflow-hidden text-ellipsis whitespace-nowrap">
        {label}
      </span>
      <span
        className={cn(
          "text-[10px] tabular-nums px-1.5 py-0.5 rounded-full shrink-0",
          active
            ? "bg-background/20 text-background"
            : "bg-muted text-muted-foreground",
        )}
      >
        {count}
      </span>
    </button>
  );
}

// ─── Filter predicate ──────────────────────────────────────────────────────

function matchesFilter(entry: PricingCardEntry, filter: FilterKey): boolean {
  if (filter === "all") return true;
  if (filter === "free") return isFree(entry.pricing);
  if (filter === "low_cost") {
    // Low Cost = total < $1.00 per 1M tokens (input + output) AND not free
    // AND not undocumented. PRD §62.
    if (!isPricingDocumented(entry.pricing)) return false;
    if (isFree(entry.pricing)) return false;
    return totalPerMillion(entry.pricing) < 1.0;
  }
  const flags = inferCapabilityFlags(entry);
  if (filter === "reasoning") return flags.reasoning;
  if (filter === "coding") return flags.coding;
  if (filter === "search") return flags.search;
  if (filter === "vision") return flags.vision;
  return true;
}

// ─── Card (PRD §63) ────────────────────────────────────────────────────────

function PricingCard({
  entry,
  multiplier,
}: {
  entry: PricingCardEntry;
  multiplier: number;
}) {
  const p = entry.pricing as ModelPricingLite;
  const documented = isPricingDocumented(p);
  const free = isFree(p);
  const responses = responsesPerXYZ(p, multiplier);
  const pSource = pricingSourceBadge(p);
  const srcBadge = sourceBadgeCls(entry.source);
  const caps = capabilityBadges(entry);

  return (
    <Card
      className={cn(
        "min-w-0 flex flex-col gap-3 p-4 sm:p-5 rounded-xl border bg-card text-card-foreground shadow-sm transition-colors",
        "border-border hover:border-foreground/20",
      )}
    >
      {/* Row 1: model display name (large, clickable) */}
      <Link
        href={modelHref(entry)}
        className="text-base font-semibold tracking-tight text-foreground hover:underline min-w-0"
        style={{
          overflowWrap: "anywhere",
          wordBreak: "break-word",
          display: "block",
        }}
        title={entry.id}
      >
        {shortModelName(entry)}
      </Link>

      {/* Row 2: provider sub-label + source badge */}
      <div className="flex items-center justify-between gap-2 min-w-0">
        <span
          className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground truncate min-w-0"
          style={{ fontFamily: "var(--font-mono), monospace" }}
          title={providerSubLabel(entry)}
        >
          {providerSubLabel(entry)}
        </span>
        <Badge
          variant="outline"
          className={cn(
            "text-[10px] uppercase tracking-wider px-1.5 py-0 h-5 shrink-0",
            srcBadge.cls,
          )}
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          {srcBadge.label}
        </Badge>
      </div>

      {/* Row 3: model id (mono, full id, wraps mid-string) */}
      <code
        className="text-[11px] text-muted-foreground bg-muted/40 px-2 py-1 rounded-md font-mono min-w-0"
        style={{
          fontFamily: "var(--font-mono), monospace",
          overflowWrap: "anywhere",
          wordBreak: "break-word",
          display: "block",
        }}
        title={entry.id}
      >
        {entry.id}
      </code>

      {/* Row 4: pricing source badge + capability badges */}
      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
        <Badge
          variant="outline"
          className={cn(
            "text-[10px] uppercase tracking-wider px-1.5 py-0 h-5",
            pSource.cls,
          )}
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          {pSource.label}
        </Badge>
        {caps.map((c) => (
          <Badge
            key={c}
            variant="outline"
            className="text-[10px] uppercase tracking-wider px-1.5 py-0 h-5 text-muted-foreground border-border"
          >
            {c}
          </Badge>
        ))}
      </div>

      {/* Row 5: pricing rows — Input / Output / Cache */}
      <div
        className="flex flex-col gap-2 min-w-0 border-t border-border pt-3"
        aria-label="Token pricing per 1M"
      >
        {documented ? (
          <>
            <PricingRow
              label="Input"
              display={
                free ? "Free" : formatPrice(p.inputPerMillion, p.currency)
              }
              suffix={free ? undefined : "/ 1M"}
            />
            <PricingRow
              label="Output"
              display={
                free ? "Free" : formatPrice(p.outputPerMillion, p.currency)
              }
              suffix={free ? undefined : "/ 1M"}
            />
            <PricingRow
              label="Cache"
              display={
                free
                  ? "Free"
                  : formatPrice(p.cachePerMillion ?? null, p.currency)
              }
              suffix={free ? undefined : "/ 1M"}
            />
          </>
        ) : (
          <p
            className="text-xs text-amber-700 dark:text-amber-400 italic min-w-0 flex items-start gap-1.5"
            style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
          >
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            Pricing not documented
          </p>
        )}
      </div>

      {/* Row 6: ~Responses / XYZ — the headline calculation */}
      <div className="flex items-baseline justify-between gap-3 min-w-0 rounded-md bg-emerald-500/5 border border-emerald-500/20 px-3 py-2">
        <span
          className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          ~Responses / XYZ
        </span>
        <span
          className="text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-300 min-w-0"
          style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
          title="Estimated responses per 1 XYZ, standardized 1000 in / 1000 out / 0 cache (PRD §41)."
        >
          {responses.kind === "finite"
            ? `~${responses.value.toLocaleString()}`
            : responses.kind === "free"
              ? "∞"
              : "—"}
        </span>
      </div>

      {/* Footer — link to the full model page */}
      <Link
        href={modelHref(entry)}
        className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground hover:text-foreground transition-colors self-start"
        style={{ fontFamily: "var(--font-mono), monospace" }}
      >
        View details →
      </Link>
    </Card>
  );
}

// ─── Pricing row helper ────────────────────────────────────────────────────

function PricingRow({
  label,
  display,
  suffix,
}: {
  label: string;
  display: string;
  suffix?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 min-w-0">
      <span
        className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0"
        style={{ fontFamily: "var(--font-mono), monospace" }}
      >
        {label}
      </span>
      <span
        className="text-sm font-medium tabular-nums text-right min-w-0"
        style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
      >
        {display}
        {suffix ? (
          <span className="text-[10px] text-muted-foreground ml-1">
            {suffix}
          </span>
        ) : null}
      </span>
    </div>
  );
}

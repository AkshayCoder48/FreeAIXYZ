import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import {
  Sparkles,
  CalendarClock,
  Layers,
  Calculator,
  ShieldCheck,
  AlertCircle,
} from "lucide-react";

import { Nav } from "@/components/nav";
import { SiteFooter } from "@/components/site";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  PricingBoardClient,
  type PricingCardEntry,
} from "@/components/pricing/pricing-board";

import {
  getUnifiedModels,
  getSessionUserId,
  getPricingVersion,
  XYZ_USD_MULTIPLIER,
  REFERENCE_REQUEST,
} from "@/lib/xyz";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Pricing — FreeAIXYZ",
  description:
    "XYZ usage credits + per-model USD token pricing for every model on FreeAIXYZ. Free models cost 0 XYZ; BYOK models cost 0 platform XYZ; paid models are billed as USD × multiplier.",
};

// ─── Page (Server Component) ──────────────────────────────────────────────

/**
 * Sort-rank helper for the cards grid. Buckets:
 *   - bucket 0: free models (status === "free")
 *   - bucket 1: documented paid models (sorted by responses/XYZ desc)
 *   - bucket 2: undocumented models (sorted alphabetically)
 * Documented priced models surface first, sorted by value-for-money
 * (cheapest per XYZ at the top of the grid). Free models lead; the
 * undocumented ones tail the grid.
 */
function rankForSort(entry: PricingCardEntry): { bucket: number; value?: number } {
  const p = entry.pricing;
  if (!p) return { bucket: 2 };
  if (p.status === "not_documented") return { bucket: 2 };
  if (p.inputPerMillion == null || p.outputPerMillion == null) {
    return { bucket: 2 };
  }
  if (p.status === "free") return { bucket: 0 };
  // PRD §41 — standardized 1000 in / 1000 out per request.
  const input = p.inputPerMillion;
  const output = p.outputPerMillion;
  const usdCost = (1000 / 1e6) * input + (1000 / 1e6) * output;
  if (usdCost <= 0) return { bucket: 0 };
  const denom = usdCost * (XYZ_USD_MULTIPLIER || 1);
  if (denom <= 0) return { bucket: 2 };
  return { bucket: 1, value: Math.floor(1 / denom) };
}

export default async function PricingPage() {
  // Resolve the user (best-effort — only needed for gratisfy lookups).
  const headerStore = await headers();
  const cookieStore = await cookies();
  const url =
    headerStore.get("x-url") || `http://localhost:3000/pricing`;
  const request = new Request(url, {
    headers: { cookie: cookieStore.toString() },
  });
  const userId = await getSessionUserId(request);

  // Single call to the unified registry — returns models + their embedded
  // pricing. We do NOT HTTP-fetch our own /api/v1/pricing route from an RSC
  // (that's an anti-pattern); we call the same server-side functions the
  // route handler itself calls. Same source of truth (PRD §23, §58).
  const { models, stale } = await getUnifiedModels(userId ?? undefined);
  const versionInfo = getPricingVersion();
  const multiplier = XYZ_USD_MULTIPLIER || 1;
  const referenceRequest = {
    inputTokens: REFERENCE_REQUEST.inputTokens,
    outputTokens: REFERENCE_REQUEST.outputTokens,
  };

  // Filter to currently-available models + serialize to plain JSON for the
  // client island. The RSC owns the data fetching; the client island owns
  // the interactivity (filter chips + card rendering).
  const entries: PricingCardEntry[] = models
    .filter((m) => m.available)
    .map((m) => ({
      id: m.id,
      displayName: m.displayName,
      source: m.source,
      provider: m.provider,
      originalModelId: m.originalModelId,
      capabilities: m.capabilities,
      pricing: m.pricing,
    }))
    .sort((a, b) => {
      // Surface the most useful cards first: documented priced models
      // (by responses/XYZ desc → cheapest per XYZ first), then free
      // models, then undocumented models last (alphabetical).
      const ra = rankForSort(a);
      const rb = rankForSort(b);
      if (ra.bucket !== rb.bucket) return ra.bucket - rb.bucket;
      if (ra.bucket === 1) return rb.value! - ra.value!; // cheapest first
      return a.id.localeCompare(b.id);
    });

  // For the hero "Pricing sources" legend — surfaced statically.
  const sourceLegend = ([
    { label: "Provider", cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" },
    { label: "Market", cls: "bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/30" },
    { label: "Manual", cls: "bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/30" },
    { label: "Undocumented", cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30" },
  ] as const);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Nav />

      <main className="flex-1 mx-auto max-w-7xl w-full px-4 sm:px-6 py-8 sm:py-12 flex flex-col gap-10 sm:gap-14 min-w-0">
        {/* ─── Page title ──────────────────────────────────────────────── */}
        <header className="flex flex-col gap-3 min-w-0">
          <div className="flex items-baseline justify-between gap-3 flex-wrap min-w-0">
            <h1
              className="text-3xl sm:text-4xl font-normal tracking-tight text-foreground"
              style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
            >
              Pricing
            </h1>
            <span
              className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >
              {entries.length} models · board v{versionInfo.version}
            </span>
          </div>
          <p className="text-sm text-muted-foreground max-w-3xl min-w-0">
            One authoritative per-model USD price. &ldquo;Free&rdquo; means
            explicitly free / open; &ldquo;Not documented&rdquo; means we
            could not establish a reliable price (we NEVER show $0 for the
            unknown case — PRD §26).
          </p>
        </header>

        {/* ─── Section 1: XYZ hero ────────────────────────────────────── */}
        <Card className="rounded-2xl border-border bg-card p-6 sm:p-8 gap-0 min-w-0">
          <div className="flex flex-col gap-6 min-w-0">
            <div className="flex flex-col gap-2 min-w-0">
              <div className="flex items-center gap-2 flex-wrap min-w-0">
                <Badge
                  variant="outline"
                  className="text-[10px] uppercase tracking-wider px-2 py-0.5 h-6 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  style={{ fontFamily: "var(--font-mono), monospace" }}
                >
                  <Sparkles className="h-3 w-3" />
                  XYZ
                </Badge>
                <span
                  className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground"
                  style={{ fontFamily: "var(--font-mono), monospace" }}
                >
                  FreeAIXYZ usage credits
                </span>
              </div>
              <h2
                className="text-2xl sm:text-3xl font-normal tracking-tight text-foreground min-w-0"
                style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
              >
                XYZ — FreeAIXYZ usage credits
              </h2>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 min-w-0">
              {/* What XYZ is */}
              <div className="flex flex-col gap-2 min-w-0 rounded-lg border border-border bg-background/50 p-4">
                <div className="flex items-center gap-2 min-w-0">
                  <Layers className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <h3 className="text-sm font-medium text-foreground">
                    What XYZ is
                  </h3>
                </div>
                <p
                  className="text-xs text-muted-foreground leading-relaxed min-w-0"
                  style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
                >
                  XYZ is a normalized usage credit, NOT &ldquo;one
                  request.&rdquo; One XYZ ≈ one US dollar of model usage at
                  market pricing (the multiplier below scales it). It lets us
                  bill across hundreds of upstreams with one unit.
                </p>
              </div>

              {/* Daily grant */}
              <div className="flex flex-col gap-2 min-w-0 rounded-lg border border-border bg-background/50 p-4">
                <div className="flex items-center gap-2 min-w-0">
                  <CalendarClock className="h-4 w-4 text-violet-600 dark:text-violet-400 shrink-0" />
                  <h3 className="text-sm font-medium text-foreground">
                    How you get it
                  </h3>
                </div>
                <p
                  className="text-xs text-muted-foreground leading-relaxed min-w-0"
                  style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
                >
                  Every signed-in user gets <strong>+1 XYZ</strong> daily —
                  granted server-side, idempotent, so signing in twice in
                  the same day never double-grants. Inspect your balance on
                  the Account page.
                </p>
              </div>

              {/* BYOK */}
              <div className="flex flex-col gap-2 min-w-0 rounded-lg border border-border bg-background/50 p-4">
                <div className="flex items-center gap-2 min-w-0">
                  <ShieldCheck className="h-4 w-4 text-slate-600 dark:text-slate-300 shrink-0" />
                  <h3 className="text-sm font-medium text-foreground">
                    BYOK is free
                  </h3>
                </div>
                <p
                  className="text-xs text-muted-foreground leading-relaxed min-w-0"
                  style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
                >
                  Free models cost 0 XYZ. BYOK models (Gratisfy / G4F)
                  cost 0 platform XYZ — your upstream key pays for usage
                  directly. XYZ is only charged for native paid models.
                </p>
              </div>
            </div>

            {/* Formula */}
            <div className="flex flex-col gap-3 min-w-0 rounded-lg border border-border bg-foreground/[0.03] p-4 sm:p-5">
              <div className="flex items-center gap-2 min-w-0">
                <Calculator className="h-4 w-4 text-foreground shrink-0" />
                <h3
                  className="text-xs uppercase tracking-[0.15em] text-foreground"
                  style={{ fontFamily: "var(--font-mono), monospace" }}
                >
                  How XYZ cost is derived
                </h3>
              </div>
              <pre
                className="text-[12px] sm:text-[13px] leading-relaxed text-foreground/80 overflow-x-auto min-w-0"
                style={{
                  fontFamily: "var(--font-code), var(--font-mono), monospace",
                  overflowWrap: "anywhere",
                  wordBreak: "break-word",
                }}
              >
{`usdCost = (input_tokens   / 1,000,000 × input_price)
        + (output_tokens  / 1,000,000 × output_price)
        + (cache_tokens   / 1,000,000 × cache_price)

xyzCost = usdCost × XYZ_USD_MULTIPLIER   (currently ${multiplier.toFixed(1)})

Example: a model priced at $0.30 / 1M input + $2.50 / 1M output, for a
1000-in / 1000-out response, costs ~$0.0028 = ~0.0028 XYZ  →  ~357 responses
per 1 XYZ.`}
              </pre>
              <p
                className="text-[11px] text-muted-foreground min-w-0"
                style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
              >
                Multiplier source:{" "}
                <code
                  className="font-mono"
                  style={{ fontFamily: "var(--font-mono), monospace" }}
                >
                  XYZ_USD_MULTIPLIER
                </code>{" "}
                env var (defaults to 1.0). Reference request used for the{" "}
                &ldquo;~responses / XYZ&rdquo; estimate:{" "}
                <code
                  className="font-mono"
                  style={{ fontFamily: "var(--font-mono), monospace" }}
                >
                  {referenceRequest.inputTokens.toLocaleString()} in /{" "}
                  {referenceRequest.outputTokens.toLocaleString()} out
                </code>{" "}
                — but the standardized estimate on each card uses{" "}
                <strong>1000 in / 1000 out / 0 cache</strong> per PRD §41 for
                apples-to-apples comparison.
              </p>
            </div>
          </div>
        </Card>

        {/* ─── Stale banner (only when discovery is degraded) ────────── */}
        {stale && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2 min-w-0">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span
              className="min-w-0"
              style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
            >
              Catalog is being served from cache — the last G4F discovery run
              may be stale. Native pricing is unaffected.
            </span>
          </div>
        )}

        {/* ─── Section 3+4+5: cards grid + filters (client island) ──── */}
        <PricingBoardClient
          entries={entries}
          multiplier={multiplier}
          referenceRequest={referenceRequest}
          boardVersion={versionInfo.version}
          updatedAt={versionInfo.updatedAt}
          sourceLegend={sourceLegend.map((s) => ({ label: s.label, cls: s.cls }))}
        />

        {/* ─── Pricing sources legend (static reference) ─────────────── */}
        <section className="flex flex-col gap-3 min-w-0">
          <h2
            className="text-xs uppercase tracking-[0.15em] text-muted-foreground"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            Pricing sources
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 min-w-0">
            {sourceLegend.map((s) => (
              <div
                key={s.label}
                className="flex items-center gap-2 min-w-0 rounded-lg border border-border bg-background/50 p-3"
              >
                <Badge
                  variant="outline"
                  className={`text-[10px] uppercase tracking-wider px-2 py-0.5 h-6 ${s.cls}`}
                  style={{ fontFamily: "var(--font-mono), monospace" }}
                >
                  {s.label}
                </Badge>
                <span
                  className="text-[11px] text-muted-foreground min-w-0"
                  style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
                >
                  {s.label === "Provider" &&
                    "Fetched live from the upstream provider's published pricing."}
                  {s.label === "Market" &&
                    "Supplied baseline representing the market-rate price."}
                  {s.label === "Manual" &&
                    "Admin override on top of the supplied baseline."}
                  {s.label === "Undocumented" &&
                    "No reliable price — model is rejected at reservation."}
                </span>
              </div>
            ))}
          </div>
        </section>
      </main>

      <SiteFooter>
        <span
          className="font-mono"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          XYZ multiplier ×{multiplier.toFixed(1)} · board v{versionInfo.version}
        </span>
        <span
          className="font-mono"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          GET /api/v1/pricing
        </span>
      </SiteFooter>
    </div>
  );
}

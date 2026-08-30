import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies, headers } from "next/headers";
import type { Metadata } from "next";
import {
  ArrowLeft,
  Clock,
  Layers,
  Sparkles,
  MessageSquare,
  Eye,
  AudioLines,
  Image as ImageIcon,
  Search as SearchIcon,
  Wrench,
  ShieldCheck,
  DollarSign,
  Zap,
  AlertCircle,
} from "lucide-react";

import { Nav } from "@/components/nav";
import { SiteFooter } from "@/components/site";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { CopyIdButton } from "@/components/explorer/copy-id-button";

import {
  resolveUnifiedModel,
  getSessionUserId,
  XYZ_USD_MULTIPLIER,
} from "@/lib/xyz";
import { db } from "@/lib/db";
import type { ModelCapabilities, ModelPricing, Source } from "@/lib/xyz/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ─── Helpers (kept visually aligned with the catalog's card styling) ───────

function sourceLabel(source: Source): string {
  if (source === "gratisfy") return "Gratisfy";
  if (source === "g4f") return "G4F";
  return "Native";
}

interface SourceBadgeMeta {
  label: string;
  cls: string;
}

function sourceBadge(source: Source): SourceBadgeMeta {
  // NATIVE=slate, GRATISFY=violet, G4F=orange. NO indigo or blue anywhere.
  if (source === "gratisfy") {
    return {
      label: "GRATISFY",
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
    label: "NATIVE",
    cls: "bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/30",
  };
}

interface StatusMeta {
  label: string;
  dot: string;
  badge: string;
}

function statusBadge(available: boolean, streaming: boolean): StatusMeta {
  if (available && streaming) {
    return {
      label: "Live",
      dot: "bg-emerald-500",
      badge:
        "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
    };
  }
  if (available && !streaming) {
    return {
      label: "Degraded",
      dot: "bg-amber-500",
      badge:
        "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
    };
  }
  return {
    label: "Unavailable",
    dot: "bg-slate-500",
    badge:
      "bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/30",
  };
}

interface CapMeta {
  key: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}

const CAP_METAS: CapMeta[] = [
  { key: "text", label: "Text", Icon: MessageSquare },
  { key: "reasoning", label: "Reasoning", Icon: Sparkles },
  { key: "vision", label: "Vision", Icon: Eye },
  { key: "webSearch", label: "Search", Icon: SearchIcon },
  { key: "image", label: "Image", Icon: ImageIcon },
  { key: "audio", label: "Audio", Icon: AudioLines },
  { key: "video", label: "Video", Icon: Zap },
  { key: "tools", label: "Tools", Icon: Wrench },
];

function capabilityList(caps: ModelCapabilities): CapMeta[] {
  return CAP_METAS.filter((c) => {
    const v = (caps as Record<string, boolean>)[c.key];
    return Boolean(v);
  });
}

function isPricingDocumented(p: ModelPricing | null | undefined): boolean {
  if (!p) return false;
  if (p.status === "not_documented") return false;
  if (p.inputPerMillion == null || p.outputPerMillion == null) return false;
  return true;
}

function formatPrice(v: number | null | undefined): string {
  if (v == null) return "Not documented";
  if (v === 0) return "$0";
  if (v < 0.01) return `$${v.toFixed(4)}`;
  if (v < 1) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(2)}`;
}

/**
 * XYZ cost for a standardized request (1000 in / 1000 out, 0 cache). PRD §41.
 * Returns null when pricing is undocumented — caller renders "—".
 */
function xyzCostForStandardRequest(
  p: ModelPricing | null | undefined,
  multiplier: number,
): number | null {
  if (!isPricingDocumented(p)) return null;
  if (p!.status === "free") return 0; // explicitly free → 0 XYZ
  const input = p!.inputPerMillion ?? 0;
  const output = p!.outputPerMillion ?? 0;
  const usdCost = (1000 / 1e6) * input + (1000 / 1e6) * output;
  if (usdCost < 0) return null;
  return usdCost * (multiplier || 1);
}

function formatXyz(v: number | null): string {
  if (v == null) return "—";
  if (v === 0) return "0";
  if (v < 0.001) return v.toExponential(2);
  if (v < 0.01) return v.toFixed(4);
  if (v < 1) return v.toFixed(4);
  return v.toFixed(3);
}

function estimatedResponsesPerXYZ(
  p: ModelPricing | null | undefined,
  multiplier: number,
):
  | { kind: "finite"; value: number }
  | { kind: "free" }
  | { kind: "unknown" } {
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

function pricingSourceBadge(
  p: ModelPricing | null | undefined,
): { label: string; cls: string } {
  // Provider=emerald, Market=slate, Manual=slate, Undocumented=amber.
  if (!p || !isPricingDocumented(p)) {
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
  // pricing-board + unknown both surface as "Market" (the supplied baseline
  // represents the market-rate baseline — PRD §24).
  return {
    label: "Market",
    cls: "bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/30",
  };
}

function deriveDescription(
  caps: ModelCapabilities,
  dbDescription: string | null | undefined,
): string {
  if (dbDescription && dbDescription.trim().length > 0) return dbDescription.trim();
  const parts: string[] = [];
  if (caps.reasoning) parts.push("reasoning");
  if (caps.vision) parts.push("vision");
  if (caps.webSearch) parts.push("web search");
  if (caps.image) parts.push("image generation");
  if (caps.audio) parts.push("audio");
  if (caps.video) parts.push("video");
  if (caps.tools) parts.push("tool use");
  if (parts.length === 0) {
    return "No description available.";
  }
  return `Supports ${parts.join(", ")}.`;
}

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
}

// ─── Page params type ───────────────────────────────────────────────────────

interface PageProps {
  params: Promise<{ provider: string; model: string }>;
}

// ─── Metadata (SEO) ──────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { provider, model } = await params;
  let modelId = model;
  try {
    modelId = decodeURIComponent(model);
  } catch {
    /* keep raw */
  }
  const shortName = modelId.split(":").pop() || modelId;
  let providerLabel = provider;
  try {
    providerLabel = decodeURIComponent(provider);
  } catch {
    /* keep raw */
  }
  return {
    title: `${shortName} — ${providerLabel.toUpperCase()} — FreeAIXYZ Models`,
    description: `Capabilities, pricing and live status for ${modelId}. Direct copy of the canonical model id, standardized XYZ cost per request, and estimated responses per 1 XYZ.`,
  };
}

// ─── Page component ──────────────────────────────────────────────────────────

export default async function ModelDetailPage({ params }: PageProps) {
  const { provider, model } = await params;

  let modelId = model;
  let providerSeg = provider;
  try {
    modelId = decodeURIComponent(model);
    providerSeg = decodeURIComponent(provider);
  } catch {
    /* keep raw — let notFound handle */
  }

  // Resolve the user (best-effort — only needed for gratisfy model lookups).
  const headerStore = await headers();
  const cookieStore = await cookies();
  const url =
    headerStore.get("x-url") ||
    `http://localhost:3000/models/${providerSeg}/${modelId}`;
  const request = new Request(url, {
    headers: { cookie: cookieStore.toString() },
  });
  const userId = await getSessionUserId(request);

  // Resolve the unified model. If the publicId doesn't parse, the registry
  // falls back to a bare native id (e.g. "tb/gpt-5") lookup.
  const resolved = await resolveUnifiedModel(modelId, userId ?? undefined);
  if (!resolved) {
    notFound();
  }

  const model_ = resolved;

  // Surface an honest mismatch warning if the URL provider segment doesn't
  // match the model's actual source or provider — keeps links honest.
  const providerMismatch =
    model_.provider.toLowerCase() !== providerSeg.toLowerCase() &&
    model_.source.toLowerCase() !== providerSeg.toLowerCase();

  // Pull the additional metadata (description, contextLength, lastVerifiedAt)
  // from the Prisma ProviderModel row — only non-native sources have a row.
  const dbRow =
    model_.source !== "native"
      ? await db.providerModel.findUnique({
          where: { publicId: model_.id },
        })
      : null;

  const description = deriveDescription(
    model_.capabilities,
    dbRow?.description ?? null,
  );
  const contextLength: number | null = dbRow?.contextLength ?? null;
  const lastVerifiedAt: string | null =
    dbRow?.lastVerifiedAt?.toISOString() ?? null;
  const discoveredAt: string = model_.discoveredAt;

  const srcBadge = sourceBadge(model_.source);
  const sBadge = statusBadge(model_.available, model_.streaming);
  const caps = capabilityList(model_.capabilities);
  const pricing = model_.pricing;
  const multiplier = XYZ_USD_MULTIPLIER || 1;
  const xyzCost = xyzCostForStandardRequest(pricing, multiplier);
  const responses = estimatedResponsesPerXYZ(pricing, multiplier);
  const pSourceBadge = pricingSourceBadge(pricing);

  // Pretty header name — use the trailing segment of originalModelId for
  // native (e.g. "tb/gpt-5" → "gpt-5"); otherwise use displayName.
  const shortName = (() => {
    const oid = model_.originalModelId || model_.displayName;
    const slash = oid.lastIndexOf("/");
    if (slash >= 0) return oid.slice(slash + 1);
    return model_.displayName || oid;
  })();

  const providerLabel = sourceLabel(model_.source);
  const providerSubLabel =
    model_.source === "native"
      ? `Native · ${model_.provider}`
      : model_.source === "g4f"
        ? `G4F · ${model_.provider}`
        : providerLabel;

  const playgroundHref = `/chat?model=${encodeURIComponent(model_.id)}`;
  const providerHref = `/models/${encodeURIComponent(model_.provider)}`;
  const modelsHref = "/models";

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Nav />

      <main className="flex-1 mx-auto max-w-6xl w-full px-4 sm:px-6 py-8 sm:py-12 flex flex-col gap-6 sm:gap-8 min-w-0">
        {/* Breadcrumb + back link */}
        <div className="flex flex-col gap-3 min-w-0">
          <Link
            href={modelsHref}
            className="inline-flex items-center gap-1.5 text-xs uppercase tracking-[0.15em] text-muted-foreground hover:text-foreground transition-colors self-start"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            All models
          </Link>
          <nav
            aria-label="Breadcrumb"
            className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0 flex-wrap"
          >
            <Link href={modelsHref} className="hover:text-foreground transition-colors">
              Models
            </Link>
            <span className="text-muted-foreground/50">/</span>
            <Link
              href={providerHref}
              className="hover:text-foreground transition-colors truncate max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap"
              title={model_.provider}
            >
              {providerSubLabel}
            </Link>
            <span className="text-muted-foreground/50">/</span>
            <span
              className="text-foreground truncate max-w-[260px] overflow-hidden text-ellipsis whitespace-nowrap"
              title={shortName}
            >
              {shortName}
            </span>
          </nav>
        </div>

        {/* Header card: name + status + source + Try-in-Playground */}
        <Card className="p-6 sm:p-8 rounded-2xl border-border bg-card gap-0 min-w-0">
          <div className="flex flex-col gap-4 min-w-0">
            {/* Status + source badges */}
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <span
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-medium ${sBadge.badge}`}
                style={{ fontFamily: "var(--font-mono), monospace" }}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${sBadge.dot}`} />
                {sBadge.label}
              </span>
              <Badge
                variant="outline"
                className={`text-[10px] uppercase tracking-wider px-2 py-0.5 h-6 ${srcBadge.cls}`}
                style={{ fontFamily: "var(--font-mono), monospace" }}
              >
                {srcBadge.label}
              </Badge>
              <span
                className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground truncate max-w-[280px] overflow-hidden text-ellipsis whitespace-nowrap"
                style={{ fontFamily: "var(--font-mono), monospace" }}
                title={providerSubLabel}
              >
                {providerSubLabel}
              </span>
            </div>

            {/* Model name (large) */}
            <h1
              className="text-3xl sm:text-4xl lg:text-5xl font-normal tracking-tight text-foreground min-w-0"
              style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
            >
              {shortName}
            </h1>

            {/* Description */}
            <p
              className="text-sm sm:text-base text-muted-foreground leading-relaxed min-w-0"
              style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
            >
              {description}
            </p>

            {/* Action: Try in Playground + Copy */}
            <div className="flex flex-wrap items-center gap-2 pt-2 min-w-0">
              <Button asChild size="default" className="h-10">
                <Link href={playgroundHref}>
                  Try in Playground
                  <ArrowLeft className="h-4 w-4 rotate-180" />
                </Link>
              </Button>
              <CopyIdButton
                value={model_.id}
                label="Copy model id"
                className="h-10"
              />
            </div>
          </div>
        </Card>

        {/* Provider mismatch warning — keeps URLs honest */}
        {providerMismatch && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2 min-w-0">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span
              className="min-w-0"
              style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
            >
              The URL provider segment (<code style={{ fontFamily: "var(--font-mono), monospace" }}>{providerSeg}</code>)
              doesn&apos;t match the model&apos;s actual source/provider (
              <code style={{ fontFamily: "var(--font-mono), monospace" }}>{model_.source}:{model_.provider}</code>).
              Showing the canonical entry anyway.
            </span>
          </div>
        )}

        {/* Two-column grid: details + pricing */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 min-w-0">
          {/* Details card (2 cols wide on lg) */}
          <Card className="lg:col-span-2 p-6 rounded-2xl border-border bg-card gap-0 min-w-0">
            <h2
              className="text-xs uppercase tracking-[0.15em] text-muted-foreground mb-4"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >
              Details
            </h2>

            <div className="flex flex-col gap-5 min-w-0">
              {/* Model ID */}
              <DetailRow
                label="Model ID"
                icon={<Layers className="h-3.5 w-3.5" />}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <code
                    className="flex-1 min-w-0 text-xs sm:text-sm bg-muted/40 px-2 py-1.5 rounded-md font-mono"
                    style={{
                      fontFamily: "var(--font-mono), monospace",
                      overflowWrap: "anywhere",
                      wordBreak: "break-word",
                    }}
                    title={model_.id}
                  >
                    {model_.id}
                  </code>
                  <CopyIdButton value={model_.id} label="Copy model id" />
                </div>
              </DetailRow>

              {/* Original upstream id */}
              {model_.originalModelId &&
                model_.originalModelId !== model_.id && (
                  <DetailRow
                    label="Upstream ID"
                    icon={<Layers className="h-3.5 w-3.5" />}
                  >
                    <code
                      className="text-xs sm:text-sm bg-muted/40 px-2 py-1.5 rounded-md font-mono min-w-0 inline-block"
                      style={{
                        fontFamily: "var(--font-mono), monospace",
                        overflowWrap: "anywhere",
                        wordBreak: "break-word",
                      }}
                      title={model_.originalModelId}
                    >
                      {model_.originalModelId}
                    </code>
                  </DetailRow>
                )}

              {/* Capabilities */}
              <DetailRow
                label="Capabilities"
                icon={<Sparkles className="h-3.5 w-3.5" />}
              >
                {caps.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 min-w-0">
                    {caps.map((c) => (
                      <Badge
                        key={c.key}
                        variant="outline"
                        className="text-[10px] uppercase tracking-wider px-2 py-0.5 h-6 text-muted-foreground border-border inline-flex items-center gap-1"
                      >
                        <c.Icon className="h-3 w-3" />
                        {c.label}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <span className="text-xs italic text-muted-foreground">
                    None advertised
                  </span>
                )}
              </DetailRow>

              {/* Context length */}
              <DetailRow
                label="Context length"
                icon={<Layers className="h-3.5 w-3.5" />}
              >
                {contextLength != null ? (
                  <span className="text-sm tabular-nums text-foreground">
                    {contextLength.toLocaleString()}{" "}
                    <span className="text-muted-foreground text-xs">tokens</span>
                  </span>
                ) : (
                  <span className="text-xs italic text-muted-foreground">
                    Not documented
                  </span>
                )}
              </DetailRow>

              {/* Streaming support */}
              <DetailRow
                label="Streaming"
                icon={<Zap className="h-3.5 w-3.5" />}
              >
                {model_.streaming ? (
                  <span className="text-sm text-foreground">
                    Supported{" "}
                    <span className="text-xs text-muted-foreground">
                      (SSE / chunked)
                    </span>
                  </span>
                ) : (
                  <span className="text-xs italic text-amber-600 dark:text-amber-400">
                    Non-streaming (degraded)
                  </span>
                )}
              </DetailRow>

              {/* Discovered / last verified */}
              <DetailRow
                label="First discovered"
                icon={<Clock className="h-3.5 w-3.5" />}
              >
                <span className="text-sm text-foreground">
                  {formatDate(discoveredAt) ?? "Unknown"}
                </span>
              </DetailRow>
              <DetailRow
                label="Last verified"
                icon={<ShieldCheck className="h-3.5 w-3.5" />}
              >
                <span className="text-sm text-foreground">
                  {formatDate(lastVerifiedAt) ?? "Unknown"}
                </span>
              </DetailRow>
            </div>
          </Card>

          {/* Pricing card (1 col wide) */}
          <Card className="lg:col-span-1 p-6 rounded-2xl border-border bg-card gap-0 min-w-0 self-start">
            <div className="flex items-center justify-between gap-2 mb-4 min-w-0">
              <h2
                className="text-xs uppercase tracking-[0.15em] text-muted-foreground"
                style={{ fontFamily: "var(--font-mono), monospace" }}
              >
                Pricing
              </h2>
              <Badge
                variant="outline"
                className={`text-[10px] uppercase tracking-wider px-2 py-0.5 h-6 ${pSourceBadge.cls}`}
                style={{ fontFamily: "var(--font-mono), monospace" }}
              >
                {pSourceBadge.label}
              </Badge>
            </div>

            {isPricingDocumented(pricing) ? (
              <div className="flex flex-col gap-4 min-w-0">
                <PricingRow
                  label="Input"
                  value={pricing!.inputPerMillion}
                  isFree={pricing!.status === "free"}
                  suffix="/ 1M tokens"
                />
                <PricingRow
                  label="Output"
                  value={pricing!.outputPerMillion}
                  isFree={pricing!.status === "free"}
                  suffix="/ 1M tokens"
                />
                <PricingRow
                  label="Cache"
                  value={pricing!.cachePerMillion ?? null}
                  isFree={pricing!.status === "free"}
                  suffix="/ 1M tokens"
                  fallback="Not documented"
                />

                <Separator className="my-1" />

                {/* Standardized XYZ cost */}
                <div className="flex flex-col gap-1.5 min-w-0">
                  <div className="flex items-baseline justify-between gap-3 min-w-0">
                    <span
                      className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0 inline-flex items-center gap-1"
                      style={{ fontFamily: "var(--font-mono), monospace" }}
                    >
                      <DollarSign className="h-3 w-3" />
                      XYZ cost / 1k·1k
                    </span>
                    <span
                      className="text-lg font-medium tabular-nums text-foreground min-w-0"
                      style={{
                        overflowWrap: "anywhere",
                        wordBreak: "break-word",
                      }}
                    >
                      {formatXyz(xyzCost)}{" "}
                      <span className="text-xs text-muted-foreground">XYZ</span>
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Standardized request — 1000 in / 1000 out / 0 cache.
                  </p>
                </div>

                {/* Estimated responses per XYZ */}
                <div className="flex flex-col gap-1.5 min-w-0">
                  <div className="flex items-baseline justify-between gap-3 min-w-0">
                    <span
                      className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0 inline-flex items-center gap-1"
                      style={{ fontFamily: "var(--font-mono), monospace" }}
                    >
                      <Sparkles className="h-3 w-3" />
                      ~Responses / XYZ
                      <span className="text-[9px] text-muted-foreground/70 normal-case tracking-normal">
                        estimated
                      </span>
                    </span>
                    <span
                      className="text-lg font-medium tabular-nums text-foreground min-w-0"
                      style={{
                        overflowWrap: "anywhere",
                        wordBreak: "break-word",
                      }}
                    >
                      {responses.kind === "finite"
                        ? `~${responses.value.toLocaleString()}`
                        : responses.kind === "free"
                          ? "∞"
                          : "—"}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Standardized 1k·1k request · pricing × XYZ multiplier.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3 min-w-0">
                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2 min-w-0">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span
                    className="min-w-0"
                    style={{
                      overflowWrap: "anywhere",
                      wordBreak: "break-word",
                    }}
                  >
                    Pricing is not documented upstream. XYZ cost is unknown —
                    the model is rejected at the reservation step (PRD §26).
                  </span>
                </div>
                <PricingRow
                  label="Input"
                  value={null}
                  isFree={false}
                  suffix="/ 1M tokens"
                  fallback="Not documented"
                />
                <PricingRow
                  label="Output"
                  value={null}
                  isFree={false}
                  suffix="/ 1M tokens"
                  fallback="Not documented"
                />
                <PricingRow
                  label="Cache"
                  value={null}
                  isFree={false}
                  suffix="/ 1M tokens"
                  fallback="Not documented"
                />
                <Separator className="my-1" />
                <div className="flex items-baseline justify-between gap-3 min-w-0">
                  <span
                    className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0"
                    style={{ fontFamily: "var(--font-mono), monospace" }}
                  >
                    XYZ cost / 1k·1k
                  </span>
                  <span className="text-sm text-muted-foreground">—</span>
                </div>
                <div className="flex items-baseline justify-between gap-3 min-w-0">
                  <span
                    className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0"
                    style={{ fontFamily: "var(--font-mono), monospace" }}
                  >
                    ~Responses / XYZ
                  </span>
                  <span className="text-sm text-muted-foreground">—</span>
                </div>
              </div>
            )}
          </Card>
        </div>
      </main>

      <SiteFooter>
        <span
          className="font-mono"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          GET /api/v1/models/unified · resolveUnifiedModel()
        </span>
        <span
          className="font-mono"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          XYZ multiplier = {multiplier}
        </span>
      </SiteFooter>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function DetailRow({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-1.5 sm:gap-4 min-w-0">
      <div
        className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0 inline-flex items-center gap-1.5 sm:w-44 pt-0.5"
        style={{ fontFamily: "var(--font-mono), monospace" }}
      >
        {icon}
        {label}
      </div>
      <div
        className="flex-1 min-w-0 text-sm text-foreground"
        style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
      >
        {children}
      </div>
    </div>
  );
}

function PricingRow({
  label,
  value,
  isFree,
  suffix,
  fallback,
}: {
  label: string;
  value: number | null | undefined;
  isFree: boolean;
  suffix?: string;
  fallback?: string;
}) {
  const display = isFree
    ? "Free"
    : value == null
      ? (fallback ?? "—")
      : formatPrice(value);
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
        {suffix && !isFree && value != null ? (
          <span className="text-[10px] text-muted-foreground ml-1">{suffix}</span>
        ) : null}
      </span>
    </div>
  );
}

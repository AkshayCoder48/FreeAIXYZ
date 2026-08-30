"use client";

/**
 * ProviderModelsClient — the per-provider grid of model cards (PRD §28).
 *
 * Receives the already-resolved model list from the server (the parent RSC
 * calls `getUnifiedModels()` server-side and passes a JSON-serializable
 * subset down). Renders a responsive grid of cards with the same visual
 * language as the main /models catalog (PRD §31) — but without the
 * in-card `<Select>` for sibling-switching, since the entire page is the
 * sibling list.
 *
 * The only client state on this page is the copy-id feedback (handled by
 * the `<CopyIdButton />` island). Pagination mirrors the catalog's
 * "Show more (+24)" pattern so providers with 5k+ models stay usable.
 */
import * as React from "react";
import Link from "next/link";
import { AlertCircle, ArrowRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { CopyIdButton } from "@/components/explorer/copy-id-button";
import type { ModelCapabilities, ModelPricing, Source } from "@/lib/xyz/types";

export interface ProviderModelEntry {
  id: string;
  displayName: string;
  source: Source;
  provider: string;
  originalModelId: string;
  streaming: boolean;
  available: boolean;
  capabilities: ModelCapabilities;
  pricing: ModelPricing;
  discoveredAt: string;
  description?: string | null;
  contextLength?: number | null;
}

interface Props {
  provider: string;
  providerLabel: string;
  source: Source;
  models: ProviderModelEntry[];
  multiplier: number;
  stale: boolean;
}

const INITIAL_VISIBLE = 24;
const LOAD_INCREMENT = 24;

export function ProviderModelsClient({
  provider,
  providerLabel,
  source,
  models,
  multiplier,
  stale,
}: Props) {
  const [visible, setVisible] = React.useState(INITIAL_VISIBLE);

  // Reset pagination when the model set changes.
  React.useEffect(() => {
    setVisible(INITIAL_VISIBLE);
  }, [models]);

  const visibleModels = models.slice(0, visible);
  const remaining = models.length - visibleModels.length;

  return (
    <div className="flex flex-col gap-6 min-w-0">
      {/* Header */}
      <header className="flex flex-col gap-3 min-w-0">
        <div className="flex items-baseline justify-between gap-3 flex-wrap min-w-0">
          <h1
            className="text-3xl sm:text-4xl font-normal tracking-tight text-foreground min-w-0"
            style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
          >
            {providerLabel}
          </h1>
          <span
            className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            {models.length} model{models.length === 1 ? "" : "s"} ·{" "}
            {sourceLabel(source)}
          </span>
        </div>
      </header>

      {/* Stale banner */}
      {stale && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2 min-w-0">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span className="min-w-0">
            Catalog is being served from cache. The last discovery run for this
            provider may be stale.
          </span>
        </div>
      )}

      {/* Empty state */}
      {models.length === 0 ? (
        <div className="text-center py-16 text-sm text-muted-foreground flex flex-col items-center gap-3">
          <span>No live models discovered under this provider.</span>
          <Link
            href="/models"
            className="text-xs uppercase tracking-[0.15em] text-foreground hover:underline inline-flex items-center gap-1.5"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            <ArrowRight className="h-3 w-3 rotate-180" />
            Back to all models
          </Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 min-w-0">
            {visibleModels.map((m) => (
              <ProviderPageCard
                key={m.id}
                model={m}
                multiplier={multiplier}
              />
            ))}
          </div>

          {remaining > 0 && (
            <div className="flex justify-center pt-2 min-w-0">
              <button
                type="button"
                onClick={() =>
                  setVisible((c) => c + LOAD_INCREMENT)
                }
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs uppercase tracking-[0.1em] border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                style={{ fontFamily: "var(--font-mono), monospace" }}
              >
                Show {Math.min(LOAD_INCREMENT, remaining)} more · {remaining}{" "}
                hidden
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Card ────────────────────────────────────────────────────────────────────

function ProviderPageCard({
  model,
  multiplier,
}: {
  model: ProviderModelEntry;
  multiplier: number;
}) {
  const sBadge = statusBadge(model.available, model.streaming);
  const srcBadge = sourceBadge(model.source);
  const caps = capabilityBadges(model.capabilities);
  const pricing = model.pricing;
  const documented = isPricingDocumented(pricing);
  const isFree = pricing?.status === "free";
  const respPer = responsesPerXYZ(pricing, multiplier);

  const shortName = (() => {
    const oid = model.originalModelId || model.displayName;
    const slash = oid.lastIndexOf("/");
    if (slash >= 0) return oid.slice(slash + 1);
    return model.displayName || oid;
  })();

  const subLabel =
    model.source === "native"
      ? `Native · ${model.provider}`
      : model.source === "g4f"
        ? `G4F · ${model.provider}`
        : sourceLabel(model.source);

  const href = `/models/${encodeURIComponent(model.provider)}/${encodeURIComponent(
    model.id,
  )}`;

  const description = modelDescription(model);

  return (
    <Card
      className="min-w-0 flex flex-col gap-3 p-4 sm:p-5 rounded-xl border bg-card text-card-foreground shadow-sm transition-colors border-border hover:border-foreground/20"
    >
      {/* Row 1: provider sub-label + status badge */}
      <div className="flex items-start justify-between gap-3 min-w-0">
        <div
          className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground min-w-0 truncate"
          style={{ fontFamily: "var(--font-mono), monospace" }}
          title={subLabel}
        >
          {subLabel}
        </div>
        <span
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-medium shrink-0 ${sBadge.badge}`}
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${sBadge.dot}`} />
          {sBadge.label}
        </span>
      </div>

      {/* Row 2: model display name (large, clickable) */}
      <Link
        href={href}
        className="text-base font-semibold tracking-tight text-foreground hover:underline min-w-0"
        style={{
          overflowWrap: "anywhere",
          wordBreak: "break-word",
          display: "block",
        }}
        title={model.id}
      >
        {shortName}
      </Link>

      {/* Row 3: description (clamped to 2 lines) */}
      <p
        className="text-xs text-muted-foreground line-clamp-2 min-w-0"
        style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
      >
        {description}
      </p>

      {/* Row 4: model id + copy button (PRD §33 — directly copyable) */}
      <div className="flex items-center gap-2 min-w-0">
        <code
          className="flex-1 min-w-0 text-[11px] text-muted-foreground bg-muted/40 px-2 py-1 rounded-md font-mono overflow-hidden text-ellipsis whitespace-nowrap"
          style={{ fontFamily: "var(--font-mono), monospace" }}
          title={model.id}
        >
          {model.id}
        </code>
        <CopyIdButton value={model.id} label="Copy model id" />
      </div>

      {/* Row 5: capability badges — flex-wrap so they wrap to next line */}
      {caps.length > 0 && (
        <div className="flex flex-wrap gap-1.5 min-w-0">
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
      )}

      {/* Row 6: source badge */}
      <div className="flex flex-wrap gap-1.5 min-w-0">
        <Badge
          variant="outline"
          className={`text-[10px] uppercase tracking-wider px-1.5 py-0 h-5 ${srcBadge.cls}`}
        >
          {srcBadge.label}
        </Badge>
      </div>

      {/* Row 7: pricing rows — flex justify-between, min-w-0 */}
      <div className="flex flex-col gap-2 min-w-0 border-t border-border pt-3 mt-1">
        {documented ? (
          <>
            <div className="flex items-baseline justify-between gap-3 min-w-0">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">
                Input
              </span>
              <span
                className="text-sm font-medium tabular-nums text-right min-w-0"
                style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
              >
                {isFree
                  ? "Free"
                  : `${formatPrice(pricing!.inputPerMillion, pricing!.currency)}/M`}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3 min-w-0">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">
                Output
              </span>
              <span
                className="text-sm font-medium tabular-nums text-right min-w-0"
                style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
              >
                {isFree
                  ? "Free"
                  : `${formatPrice(pricing!.outputPerMillion, pricing!.currency)}/M`}
              </span>
            </div>
            {respPer !== null && (
              <div className="flex items-baseline justify-between gap-3 min-w-0">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">
                  ~Responses / XYZ
                </span>
                <span
                  className="text-sm font-medium tabular-nums text-right min-w-0"
                  style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
                >
                  ~{respPer.toLocaleString()}
                </span>
              </div>
            )}
          </>
        ) : (
          <p
            className="text-xs text-muted-foreground italic min-w-0"
            style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
          >
            Pricing not documented
          </p>
        )}
      </div>
    </Card>
  );
}

// ─── Helpers (kept visually aligned with the catalog's card styling) ───────

function sourceLabel(source: Source): string {
  if (source === "gratisfy") return "Gratisfy";
  if (source === "g4f") return "G4F";
  return "Native";
}

function statusBadge(available: boolean, streaming: boolean) {
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

function sourceBadge(source: Source) {
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

function capabilityBadges(caps: ModelCapabilities): string[] {
  const out: string[] = [];
  if (caps.text) out.push("Chat");
  if (caps.reasoning) out.push("Reasoning");
  if (caps.vision) out.push("Vision");
  if (caps.webSearch) out.push("Search");
  if (caps.image) out.push("Image");
  if (caps.audio) out.push("Audio");
  if (caps.video) out.push("Video");
  if (caps.tools) out.push("Tools");
  return out;
}

function isPricingDocumented(p: ModelPricing | undefined | null): boolean {
  if (!p) return false;
  if (p.status === "not_documented") return false;
  if (p.inputPerMillion == null || p.outputPerMillion == null) return false;
  return true;
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

function responsesPerXYZ(
  p: ModelPricing | undefined | null,
  multiplier: number,
): number | null {
  if (!isPricingDocumented(p)) return null;
  if (p!.status === "free") return null;
  const input = p!.inputPerMillion ?? 0;
  const output = p!.outputPerMillion ?? 0;
  const usdCost = (1000 / 1e6) * input + (1000 / 1e6) * output;
  if (usdCost <= 0) return null;
  const denom = usdCost * (multiplier || 1);
  if (denom <= 0) return null;
  return Math.floor(1 / denom);
}

function modelDescription(m: ProviderModelEntry): string {
  if (m.description && m.description.trim().length > 0) return m.description.trim();
  const caps = m.capabilities;
  const parts: string[] = [];
  if (caps.reasoning) parts.push("reasoning");
  if (caps.vision) parts.push("vision");
  if (caps.webSearch) parts.push("web search");
  if (caps.image) parts.push("image gen");
  if (caps.audio) parts.push("audio");
  if (caps.video) parts.push("video");
  if (caps.tools) parts.push("tool use");
  if (parts.length === 0) {
    return caps.text ? "Text completion model" : "Specialized model";
  }
  return `Supports ${parts.join(", ")}`;
}

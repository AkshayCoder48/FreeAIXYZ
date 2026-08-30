"use client";

/**
 * ModelCard — single card for the Model Explorer (PRD §52, §105).
 *
 * Renders a discovered model with:
 *   - Canonical id (`fg/gpt-5`) — NO custom names (PRD §22, §52).
 *   - Provider short-id chip + display name.
 *   - Capability badges — only rendered when the capability is set to true
 *     with evidence (PRD §105 — don't invent capabilities).
 *   - Status dot (active=emerald, degraded=amber, offline=rose) — PRD §54.
 *   - Latency + lastVerified relative time.
 *   - Context window (if metadata.contextWindow > 0).
 *   - Expandable detail panel: discoveredFrom, discoveryMode, raw metadata.
 *
 * Minimalist Modern styling: rounded-xl card with subtle border, gradient
 * border-accent on hover, accent dot, mono badges.
 */

import * as React from "react";
import {
  ChevronRight,
  Clock,
  Gauge,
  Hash,
  MessageSquare,
  Eye,
  Wrench,
  Zap,
  Image as ImageIcon,
  Volume2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { DiscoveredModel } from "@/lib/gateway";

interface ModelCardProps {
  model: DiscoveredModel;
  /** Latency in ms (last verified). */
  latencyMs?: number;
  defaultOpen?: boolean;
}

type CapKey =
  | "streaming"
  | "vision"
  | "tools"
  | "image"
  | "audioInput"
  | "audioOutput";

interface CapMeta {
  label: string;
  icon: typeof Zap;
}

const CAP_META: Record<CapKey, CapMeta> = {
  streaming: { label: "STREAM", icon: Zap },
  vision: { label: "VISION", icon: Eye },
  tools: { label: "TOOLS", icon: Wrench },
  image: { label: "IMAGE", icon: ImageIcon },
  audioInput: { label: "AUDIO-IN", icon: Volume2 },
  audioOutput: { label: "AUDIO-OUT", icon: Volume2 },
};

function statusDotClass(status: string): string {
  switch (status) {
    case "active":
      return "bg-emerald-500";
    case "degraded":
      return "bg-amber-500";
    case "offline":
      return "bg-rose-500";
    default:
      return "bg-muted-foreground/40";
  }
}

function formatCtx(tokens?: number): string {
  if (!tokens || tokens <= 0) return "—";
  if (tokens >= 1_000_000) {
    const v = tokens / 1_000_000;
    return `${v % 1 ? v.toFixed(1) : v}M`;
  }
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`;
  return String(tokens);
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
  const days = Math.floor(diff / 86_400_000);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export function ModelCard({ model, latencyMs, defaultOpen }: ModelCardProps) {
  const [open, setOpen] = React.useState<boolean>(Boolean(defaultOpen));

  const caps: CapKey[] = (Object.keys(CAP_META) as CapKey[]).filter((k) =>
    Boolean(model.capabilities?.[k]),
  );

  const ctx = model.metadata?.contextWindow ?? 0;
  const maxOut = model.metadata?.maxOutputTokens ?? 0;
  const source = model.metadata?.source;
  const raw = model.metadata?.raw as Record<string, unknown> | null | undefined;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="group relative rounded-xl bg-gradient-to-br p-[1.5px] from-transparent to-transparent transition-all hover:from-[#0052FF] hover:via-[#4D7CFF] hover:to-[#0052FF] hover:shadow-accent"
    >
      <div className="relative rounded-[calc(12px-1.5px)] border border-border bg-card h-full transition-colors group-hover:border-transparent">
        <div className="p-4">
          {/* Header row */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={cn(
                    "inline-block h-2 w-2 rounded-full shrink-0",
                    statusDotClass(model.status),
                  )}
                  aria-hidden
                />
                <code
                  className="text-sm font-semibold text-foreground break-all"
                  style={{ fontFamily: "var(--font-mono), monospace" }}
                >
                  {model.id}
                </code>
              </div>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span
                  className="inline-flex items-center px-2 py-0.5 rounded-md bg-accent/5 border border-accent/20 text-[10px] font-medium text-accent"
                  style={{ fontFamily: "var(--font-mono), monospace" }}
                >
                  {model.providerName || model.providerId}
                </span>
                <span
                  className="text-[10px] text-muted-foreground uppercase tracking-[0.15em]"
                  style={{ fontFamily: "var(--font-mono), monospace" }}
                >
                  {model.status}
                </span>
              </div>
            </div>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="h-8 w-8 shrink-0 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-white hover:border-accent transition-colors"
                aria-label={open ? "Collapse" : "Expand"}
              >
                <ChevronRight
                  className={cn("h-4 w-4 transition-transform", open && "rotate-90")}
                  strokeWidth={1.75}
                />
              </button>
            </CollapsibleTrigger>
          </div>

          {/* Upstream id row */}
          <div
            className="mt-3 text-[11px] text-muted-foreground flex items-center gap-1.5"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            <Hash className="h-3 w-3" />
            <span className="break-all">{model.upstreamId}</span>
          </div>

          {/* Capability badges */}
          {caps.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {caps.map((c) => {
                const meta = CAP_META[c];
                return (
                  <span
                    key={c}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-[0.1em] border border-accent/30 bg-accent/5 text-accent"
                    style={{ fontFamily: "var(--font-mono), monospace" }}
                  >
                    <meta.icon className="h-2.5 w-2.5" strokeWidth={1.75} />
                    {meta.label}
                  </span>
                );
              })}
            </div>
          )}

          {/* Metadata footer */}
          <div className="mt-3 pt-3 border-t border-border grid grid-cols-3 gap-3 text-[11px] text-muted-foreground">
            <div className="flex items-center gap-1.5" title="Context window">
              <MessageSquare className="h-3 w-3" strokeWidth={1.75} />
              <span style={{ fontFamily: "var(--font-mono), monospace" }}>
                ctx {formatCtx(ctx)}
              </span>
            </div>
            <div className="flex items-center gap-1.5" title="Last verified">
              <Clock className="h-3 w-3" strokeWidth={1.75} />
              <span style={{ fontFamily: "var(--font-mono), monospace" }}>
                {formatRelative(model.lastVerifiedAt)}
              </span>
            </div>
            <div className="flex items-center gap-1.5" title="Provider latency">
              <Gauge className="h-3 w-3" strokeWidth={1.75} />
              <span style={{ fontFamily: "var(--font-mono), monospace" }}>
                {typeof latencyMs === "number" && latencyMs > 0
                  ? `${latencyMs}ms`
                  : "—"}
              </span>
            </div>
          </div>
        </div>

        <CollapsibleContent>
          <div className="border-t border-border p-4 bg-muted/30 text-[11px] space-y-2 rounded-b-[11px]">
            <DetailRow label="discoveredFrom" value={model.discoveredFrom ?? "—"} />
            <DetailRow label="discoveryMode" value={model.discoveryMode} />
            <DetailRow label="discoveredAt" value={formatRelative(model.discoveredAt)} />
            <DetailRow label="lastVerifiedAt" value={formatRelative(model.lastVerifiedAt)} />
            <DetailRow label="providerId" value={model.providerId} />
            <DetailRow label="providerName" value={model.providerName} />
            {source && <DetailRow label="metadata.source" value={source} />}
            {maxOut > 0 && (
              <DetailRow label="metadata.maxOutputTokens" value={String(maxOut)} />
            )}
            {raw !== null && raw !== undefined && (
              <div>
                <div
                  className="text-muted-foreground uppercase tracking-[0.15em] mb-1"
                  style={{ fontFamily: "var(--font-mono), monospace" }}
                >
                  metadata.raw
                </div>
                <pre
                  className="overflow-auto p-2 rounded-md border border-border bg-background text-[10px] leading-relaxed max-h-40 custom-scroll"
                  style={{ fontFamily: "var(--font-mono), monospace" }}
                >
                  <code>{JSON.stringify(raw, null, 2)}</code>
                </pre>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <span
        className="text-muted-foreground uppercase tracking-[0.15em] w-44 shrink-0"
        style={{ fontFamily: "var(--font-mono), monospace" }}
      >
        {label}
      </span>
      <span
        className="text-foreground break-all"
        style={{ fontFamily: "var(--font-mono), monospace" }}
      >
        {value}
      </span>
    </div>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import {
  ArrowLeft,
  MessageSquare,
  Check,
  X,
  Zap,
  Brain,
  Eye,
  Wrench,
  Globe,
  Layers,
} from "lucide-react";

import { AuroraShell } from "@/components/aurora/shell";
import { CopyIdButton } from "@/components/explorer/copy-id-button";
import { fleetGroupLabel } from "@/components/explorer/fleet-meta";
import { findFleetCatalogModel } from "@/lib/native-catalog";

export const dynamic = "force-static";

// ─── Page params type ───────────────────────────────────────────────────────

interface PageProps {
  params: Promise<{ provider: string; model: string }>;
}

// ─── Metadata (SEO) ──────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { model } = await params;
  const id = decodeParam(model);
  const entry = findFleetCatalogModel(id);
  return {
    title: entry ? `${entry.name} — FreeAIXYZ` : "Model — FreeAIXYZ",
    description: entry?.brief ?? "Onyx AI fleet model detail page.",
  };
}

function decodeParam(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

// ─── Page component ──────────────────────────────────────────────────────────

/**
 * /models/[provider]/[model] — one Onyx fleet model's detail page.
 *
 * The model slug accepts ONLY public onyx-* fleet ids; anything else
 * (legacy provider-prefixed ids like "gpt-5") redirects to /models. The
 * provider segment must be the model's fleet-group slug — mismatches are
 * canonicalised to /models/<group>/<id>.
 */
export default async function FleetModelDetailPage({ params }: PageProps) {
  const { provider, model } = await params;
  const modelId = decodeParam(model);
  const providerParam = decodeParam(provider);

  const entry = findFleetCatalogModel(modelId);
  if (!entry) {
    // Non-onyx slugs (old provider-prefixed ids) are no longer public.
    redirect("/models");
  }
  if (providerParam !== entry.group) {
    // Canonicalise the URL to the model's fleet-group segment.
    redirect(`/models/${entry.group}/${encodeURIComponent(entry.id)}`);
  }

  const caps = entry.capabilities;
  const groupLabel = fleetGroupLabel(entry.group);

  const capabilityRows: Array<{
    label: string;
    ok: boolean;
    icon: React.ReactNode;
  }> = [
    {
      label: "Token-by-token streaming",
      ok: caps.streaming,
      icon: <Zap className="h-4 w-4" />,
    },
    {
      label: "Reasoning / chain-of-thought",
      ok: caps.reasoning,
      icon: <Brain className="h-4 w-4" />,
    },
    { label: "Vision (image inputs)", ok: caps.vision, icon: <Eye className="h-4 w-4" /> },
    { label: "Tool / function calling", ok: caps.tools, icon: <Wrench className="h-4 w-4" /> },
    { label: "Live web search", ok: caps.webSearch, icon: <Globe className="h-4 w-4" /> },
    { label: "Multi-turn conversation", ok: caps.multiTurn, icon: <Layers className="h-4 w-4" /> },
  ];

  return (
    <AuroraShell>
      <div className="pt-10 sm:pt-14 flex flex-col gap-8 min-w-0">
        {/* Breadcrumb */}
        <div className="flex items-center gap-3 flex-wrap">
          <Link
            href="/models"
            className="font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground hover:text-white transition-colors inline-flex items-center gap-1.5"
          >
            <ArrowLeft className="h-3 w-3" />
            All models
          </Link>
          <span className="text-hd-line">/</span>
          <Link
            href={`/models/${entry.group}`}
            className="font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground hover:text-white transition-colors"
          >
            {groupLabel}
          </Link>
        </div>

        {/* Header */}
        <header className="flex flex-col gap-3">
          <span className="fxz-section-eyebrow">
            {entry.providerName} · {groupLabel}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <span className="fxz-badge fxz-badge-warm">fleet</span>
            <span className="fxz-badge fxz-badge-warm">free</span>
            {entry.uncensored && (
              <span
                className="fxz-badge-nsfw gap-1.5"
                title="Hard-test verified uncensored · adults only"
              >
                18+ uncensored
              </span>
            )}
            {caps.streaming && (
              <span className="fxz-badge fxz-badge-ember gap-1">
                <Zap className="h-3 w-3" /> streaming
              </span>
            )}
            {caps.reasoning && (
              <span className="fxz-badge fxz-badge-warm gap-1">
                <Brain className="h-3 w-3" /> reasoning
              </span>
            )}
            {caps.tools && (
              <span className="fxz-badge fxz-badge-warm gap-1">
                <Wrench className="h-3 w-3" /> tools
              </span>
            )}
          </div>
          <h1 className="fxz-page-title" style={{ overflowWrap: "anywhere" }}>
            {entry.name}
          </h1>
          <p className="text-[15px] text-white/90 max-w-3xl leading-relaxed font-medium">
            {entry.brief}
          </p>
          {entry.description && (
            <p className="text-[15px] text-muted-foreground max-w-3xl leading-relaxed">
              {entry.description}
            </p>
          )}
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* Left column: capabilities + metadata */}
          <div className="lg:col-span-2 space-y-6 min-w-0">
            <div className="fxz-panel rounded-xl p-5 sm:p-6">
              <h2 className="text-lg font-semibold text-white mb-4">
                Capabilities
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {capabilityRows.map((row) => (
                  <div
                    key={row.label}
                    className="flex items-center gap-2.5 text-sm"
                  >
                    <span
                      className={
                        row.ok
                          ? "text-crimson"
                          : "text-hd-line"
                      }
                    >
                      {row.ok ? (
                        <span className="fxz-icon-tile h-7 w-7">
                          {row.icon}
                        </span>
                      ) : (
                        <span className="inline-flex items-center justify-center h-7 w-7 rounded-xl border border-white/[0.07] bg-white/[0.02] text-hd-line">
                          {row.icon}
                        </span>
                      )}
                    </span>
                    <span
                      className={
                        row.ok
                          ? "text-[#e2e2ea]"
                          : "text-muted-foreground line-through"
                      }
                    >
                      {row.label}
                    </span>
                    {row.ok ? (
                      <Check className="h-3.5 w-3.5 text-gold ml-auto shrink-0" />
                    ) : (
                      <X className="h-3.5 w-3.5 text-hd-line ml-auto shrink-0" />
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="fxz-panel rounded-xl p-5 sm:p-6">
              <h2 className="text-lg font-semibold text-white mb-4">
                Metadata
              </h2>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Provider</span>
                  <span className="font-medium text-white">{entry.providerName}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Fleet line</span>
                  <span className="font-medium text-white">{groupLabel}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Model id</span>
                  <span className="fxz-code">{entry.id}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Context window</span>
                  <span className="font-mono text-[#e2e2ea]">
                    {entry.contextWindow > 0
                      ? `${entry.contextWindow.toLocaleString()} tokens`
                      : "unknown"}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Access</span>
                  <span className="text-gold font-medium">
                    Free · no API key required
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Right column: actions + model id */}
          <div className="space-y-6 min-w-0">
            <div className="fxz-panel rounded-xl p-5 sm:p-6">
              <h2 className="text-lg font-semibold text-white mb-4">
                Try it
              </h2>
              <Link
                href={`/chat?model=${encodeURIComponent(entry.id)}`}
                className="fxz-keycap w-full"
              >
                <MessageSquare className="h-4 w-4" />
                Try in chat
              </Link>
              <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
                Opens the playground with <span className="fxz-code">{entry.id}</span>{" "}
                preselected.
              </p>
            </div>

            <div className="fxz-panel rounded-xl p-5 sm:p-6">
              <h2 className="text-lg font-semibold text-white mb-4">
                Model ID
              </h2>
              <div className="space-y-3">
                <code
                  className="fxz-code block w-full text-xs"
                  style={{ overflowWrap: "anywhere", whiteSpace: "normal" }}
                >
                  {entry.id}
                </code>
                <div className="flex items-center gap-2 flex-wrap">
                  <CopyIdButton value={entry.id} />
                  <span className="text-[11px] text-muted-foreground">
                    Use this id with <span className="fxz-code">POST /api/v1/chat/completions</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AuroraShell>
  );
}

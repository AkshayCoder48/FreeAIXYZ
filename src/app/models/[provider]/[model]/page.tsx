import Link from "next/link";
import { notFound } from "next/navigation";
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
import { findNativeModel } from "@/lib/native-catalog";
import { getProviderEntry } from "@/lib/gateway/ids";

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
  const entry = findNativeModel(id);
  return {
    title: entry ? `${entry.name} — FreeAIXYZ` : "Model — FreeAIXYZ",
    description: entry?.description ?? "Native model detail page.",
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

export default async function ModelDetailPage({ params }: PageProps) {
  const { provider, model } = await params;
  const modelId = decodeParam(model);
  const providerParam = decodeParam(provider);

  const entry = findNativeModel(modelId);
  if (!entry) notFound();
  // Cross-check: the provider segment in the URL must match the model.
  const providerEntry = getProviderEntry(entry.providerId);
  if (
    providerParam !== entry.providerId &&
    providerParam !== providerEntry?.shortId
  ) {
    notFound();
  }

  const caps = entry.capabilities;

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
            className="text-xs uppercase tracking-[0.15em] text-[#9c9c9d] hover:text-white transition-colors inline-flex items-center gap-1.5"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            <ArrowLeft className="h-3 w-3" />
            All models
          </Link>
          <span className="text-[#5c5c5f]">/</span>
          <Link
            href={`/models/${encodeURIComponent(entry.providerId)}`}
            className="text-xs uppercase tracking-[0.15em] text-[#9c9c9d] hover:text-white transition-colors"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            {entry.providerName}
          </Link>
        </div>

        {/* Header */}
        <header className="flex flex-col gap-3">
          <span className="fxz-section-eyebrow">Model · {entry.providerName}</span>
          <div className="flex flex-wrap items-center gap-2">
            <span className="fxz-badge fxz-badge-warm">native</span>
            <span className="fxz-badge fxz-badge-warm">free</span>
            {caps.streaming && (
              <span className="fxz-badge gap-1">
                <Zap className="h-3 w-3 text-[#ffb347]" /> streaming
              </span>
            )}
            {caps.reasoning && (
              <span className="fxz-badge gap-1">
                <Brain className="h-3 w-3 text-[#ff6b4a]" /> reasoning
              </span>
            )}
            {caps.tools && (
              <span className="fxz-badge gap-1">
                <Wrench className="h-3 w-3 text-[#ff6b4a]" /> tools
              </span>
            )}
          </div>
          <h1 className="fxz-page-title" style={{ overflowWrap: "anywhere" }}>
            {entry.name}
          </h1>
          {entry.description && (
            <p className="text-[15px] text-[#9c9c9d] max-w-3xl leading-relaxed">
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
                          ? "text-[#ff6b4a]"
                          : "text-[#5c5c5f]"
                      }
                    >
                      {row.ok ? (
                        <span className="inline-flex items-center justify-center h-7 w-7 rounded-lg border border-[#ff6b4a]/30 bg-[#ff2f3a]/[0.08]">
                          {row.icon}
                        </span>
                      ) : (
                        <span className="inline-flex items-center justify-center h-7 w-7 rounded-lg border border-white/[0.07] bg-white/[0.02] text-[#5c5c5f]">
                          {row.icon}
                        </span>
                      )}
                    </span>
                    <span
                      className={
                        row.ok
                          ? "text-zinc-100"
                          : "text-[#7c7c7f] line-through"
                      }
                    >
                      {row.label}
                    </span>
                    {row.ok ? (
                      <Check className="h-3.5 w-3.5 text-[#ffb347] ml-auto shrink-0" />
                    ) : (
                      <X className="h-3.5 w-3.5 text-[#5c5c5f] ml-auto shrink-0" />
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
                  <span className="text-[#9c9c9d]">Provider</span>
                  <span className="font-medium text-white">{entry.providerName}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-[#9c9c9d]">Upstream id</span>
                  <span className="fxz-code">{entry.upstreamId}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-[#9c9c9d]">Context window</span>
                  <span className="font-mono text-zinc-200">
                    {entry.contextWindow > 0
                      ? `${entry.contextWindow.toLocaleString()} tokens`
                      : "unknown"}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-[#9c9c9d]">Access</span>
                  <span className="text-[#ffb347] font-medium">
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
                Open in Playground
              </Link>
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
                  <span className="text-[11px] text-[#9c9c9d]">
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

import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  ArrowLeft,
  MessageSquare,
  Zap,
  Brain,
  Eye,
  Wrench,
  Globe,
  Layers,
} from "lucide-react";

import { Nav } from "@/components/nav";
import { SiteFooter } from "@/components/site";
import { CopyIdButton } from "@/components/explorer/copy-id-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
    <div className="min-h-screen flex flex-col bg-background">
      <Nav />

      <main className="flex-1 mx-auto max-w-7xl w-full px-4 sm:px-6 py-8 sm:py-12 flex flex-col gap-6">
        {/* Breadcrumb */}
        <div className="flex items-center gap-3 flex-wrap">
          <Link
            href="/models"
            className="text-xs uppercase tracking-[0.15em] text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1.5"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            <ArrowLeft className="h-3 w-3" />
            All models
          </Link>
          <span className="text-muted-foreground/40">/</span>
          <Link
            href={`/models/${encodeURIComponent(entry.providerId)}`}
            className="text-xs uppercase tracking-[0.15em] text-muted-foreground hover:text-foreground transition-colors"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            {entry.providerName}
          </Link>
        </div>

        {/* Header */}
        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">native</Badge>
            <Badge variant="outline">free</Badge>
            {caps.streaming && (
              <Badge variant="secondary" className="gap-1">
                <Zap className="h-3 w-3" /> streaming
              </Badge>
            )}
            {caps.reasoning && (
              <Badge variant="secondary" className="gap-1">
                <Brain className="h-3 w-3" /> reasoning
              </Badge>
            )}
          </div>
          <h1 className="text-3xl sm:text-4xl font-normal tracking-tight text-foreground">
            {entry.name}
          </h1>
          {entry.description && (
            <p className="text-sm text-muted-foreground max-w-3xl leading-relaxed">
              {entry.description}
            </p>
          )}
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* Left column: capabilities + metadata */}
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Capabilities</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {capabilityRows.map((row) => (
                    <div
                      key={row.label}
                      className="flex items-center gap-2.5 text-sm"
                    >
                      <span
                        className={
                          row.ok
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-muted-foreground/50"
                        }
                      >
                        {row.icon}
                      </span>
                      <span
                        className={
                          row.ok
                            ? "text-foreground"
                            : "text-muted-foreground/60 line-through"
                        }
                      >
                        {row.label}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Metadata</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Provider</span>
                  <span className="font-medium">{entry.providerName}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Upstream id</span>
                  <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">
                    {entry.upstreamId}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Context window</span>
                  <span className="font-mono">
                    {entry.contextWindow > 0
                      ? `${entry.contextWindow.toLocaleString()} tokens`
                      : "unknown"}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Access</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                    Free · no API key required
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right column: actions + model id */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Try it</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button asChild className="w-full" size="lg">
                  <Link href={`/chat?model=${encodeURIComponent(entry.id)}`}>
                    <MessageSquare className="h-4 w-4 mr-2" />
                    Open in Playground
                  </Link>
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Model ID</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <code
                  className="block w-full text-xs font-mono bg-muted rounded px-3 py-2"
                  style={{
                    fontFamily: "var(--font-mono), monospace",
                    overflowWrap: "anywhere",
                  }}
                >
                  {entry.id}
                </code>
                <div className="flex items-center gap-2">
                  <CopyIdButton value={entry.id} />
                  <span className="text-[11px] text-muted-foreground">
                    Use this id with POST /api/v1/chat/completions
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      <SiteFooter>
        <span>
          {entry.providerName} · {entry.name} · native model
        </span>
        <span
          className="font-mono"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          GET /api/v1/models
        </span>
      </SiteFooter>
    </div>
  );
}

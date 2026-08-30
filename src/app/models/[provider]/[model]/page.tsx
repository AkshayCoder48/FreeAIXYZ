/**
 * Individual model page (PRD §32, §33, §78).
 *
 * Route: /models/[provider]/[model]
 * - <provider> is the source segment ("native" | "g4f" | "gratisfy")
 * - <model> is the URL-encoded full publicId (e.g. "native%3Atb%3Agpt-5")
 *
 * RSC — server-side. Calls `resolveUnifiedModel()` directly (no HTTP hop).
 */

import { notFound } from "next/navigation";
import Link from "next/link";
import { resolveUnifiedModel } from "@/lib/xyz/registry";
import { getSuppliedPricingBoard, REFERENCE_REQUEST, XYZ_USD_MULTIPLIER } from "@/lib/xyz/pricing-board";
import { estimateResponsesPerXYZ } from "@/lib/xyz/credit";
import { getSessionUserId } from "@/lib/xyz/auth";
import { SiteFooter } from "@/components/site/site-footer";
import { Nav } from "@/components/nav";
import { CopyIdButton } from "@/components/explorer/copy-id-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ExternalLink, MessageSquare, ShieldCheck, AlertTriangle, Clock } from "lucide-react";

/** Format a USD price per million tokens — "Not documented" for null, "Free" for 0. */
function formatUsd(perMillion: number | null | undefined): string {
  if (perMillion == null) return "Not documented";
  if (perMillion === 0) return "Free";
  if (perMillion < 0.01) return `$${perMillion.toFixed(4)}`;
  if (perMillion < 1) return `$${perMillion.toFixed(3)}`;
  return `$${perMillion.toFixed(2)}`;
}

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ provider: string; model: string }>;
}

export default async function ModelDetailPage({ params }: PageProps) {
  const { provider: providerSeg, model: modelSeg } = await params;
  // Decode the model segment — it's URL-encoded.
  const modelId = decodeURIComponent(modelSeg);

  // Try to resolve via the registry. Pass userId so BYOK models are visible
  // to the user who has the right key.
  const userId = await getSessionUserIdSafe();
  const model = await resolveUnifiedModel(modelId, userId ?? undefined);

  if (!model) {
    notFound();
  }

  // Compute the standardized XYZ cost + responses-per-XYZ.
  const estimate = estimateResponsesPerXYZ(model.originalModelId, model.pricing);
  const refIn = REFERENCE_REQUEST.inputTokens;
  const refOut = REFERENCE_REQUEST.outputTokens;
  const inPrice = model.pricing.inputPerMillion;
  const outPrice = model.pricing.outputPerMillion;
  const cachePrice = model.pricing.cachePerMillion;
  const multiplier = XYZ_USD_MULTIPLIER;

  const refUsdCost =
    inPrice != null && outPrice != null
      ? (refIn / 1_000_000) * inPrice + (refOut / 1_000_000) * outPrice
      : null;
  const refXyzCost = refUsdCost != null ? refUsdCost * multiplier : null;
  const responsesPerXyz = estimate?.perXyz ?? null;

  const isFree =
    (inPrice === 0 || inPrice == null) && (outPrice === 0 || outPrice == null);

  // Source badge color
  const sourceBadge =
    model.source === "native"
      ? { label: "NATIVE", color: "bg-slate-100 text-slate-700 border-slate-300" }
      : model.source === "gratisfy"
        ? { label: "GRATISFY", color: "bg-violet-100 text-violet-700 border-violet-300" }
        : { label: "G4F", color: "bg-orange-100 text-orange-700 border-orange-300" };

  // Status badge
  const statusBadge = model.available
    ? { label: "Live", color: "bg-emerald-100 text-emerald-700 border-emerald-300" }
    : { label: "Unavailable", color: "bg-slate-100 text-slate-600 border-slate-300" };

  // Pricing source badge
  const pricingSourceBadge =
    model.pricing.source === "provider"
      ? { label: "Provider", color: "bg-emerald-100 text-emerald-700 border-emerald-300" }
      : model.pricing.source === "pricing-board"
        ? { label: "Market", color: "bg-slate-100 text-slate-600 border-slate-300" }
        : model.pricing.source === "manual"
          ? { label: "Manual", color: "bg-slate-100 text-slate-600 border-slate-300" }
          : { label: "Undocumented", color: "bg-amber-100 text-amber-700 border-amber-300" };

  const capabilityLabels: { key: keyof typeof model.capabilities; label: string }[] = [
    { key: "text", label: "Chat" },
    { key: "vision", label: "Vision" },
    { key: "audio", label: "Audio" },
    { key: "video", label: "Video" },
    { key: "image", label: "Image" },
    { key: "reasoning", label: "Reasoning" },
    { key: "webSearch", label: "Search" },
    { key: "streaming", label: "Streaming" },
    { key: "tools", label: "Tools" },
  ];
  const activeCapabilities = capabilityLabels.filter(
    (c) => model.capabilities[c.key],
  );

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Nav />
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 mt-16">
        {/* Breadcrumb */}
        <div className="mb-4">
          <Link
            href="/models"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to catalog
          </Link>
        </div>

        {/* Header */}
        <div className="flex flex-col gap-4 mb-8">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
              {model.displayName}
            </h1>
            <Badge variant="outline" className={sourceBadge.color}>
              {sourceBadge.label}
            </Badge>
            <Badge variant="outline" className={statusBadge.color}>
              ● {statusBadge.label}
            </Badge>
            {model.source !== "native" && (
              <Badge variant="outline" className="bg-violet-100 text-violet-700 border-violet-300">
                BYOK
              </Badge>
            )}
          </div>
          <div className="text-muted-foreground text-base">
            Provider: <span className="font-medium text-foreground">{model.provider}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column: details */}
          <div className="lg:col-span-2 space-y-6">
            {/* Description */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Description</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {model.metadata.description
                    ? String(model.metadata.description)
                    : model.displayName + " — a " + model.source + " model from " + model.provider + "."}
                </p>
              </CardContent>
            </Card>

            {/* Model ID — directly copyable (PRD §33) */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Model ID</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap items-stretch gap-3">
                  <code
                    className="flex-1 min-w-0 px-3 py-2 bg-slate-50 dark:bg-slate-900 border rounded-md text-xs font-mono text-foreground break-all"
                    style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
                  >
                    {model.id}
                  </code>
                  <CopyIdButton id={model.id} />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  The exact original model ID. Use this in API requests to /api/v1/chat/completions.
                </p>
              </CardContent>
            </Card>

            {/* Capabilities */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Capabilities</CardTitle>
              </CardHeader>
              <CardContent>
                {activeCapabilities.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No capabilities advertised.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {activeCapabilities.map((c) => (
                      <Badge key={c.key} variant="secondary" className="bg-slate-100 text-slate-700">
                        {c.label}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Pricing */}
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-lg">Pricing</CardTitle>
                  <Badge variant="outline" className={pricingSourceBadge.color}>
                    {pricingSourceBadge.label}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <PricingRow
                    label="Input"
                    perMillion={inPrice}
                    isFree={isFree && inPrice === 0}
                  />
                  <PricingRow
                    label="Output"
                    perMillion={outPrice}
                    isFree={isFree && outPrice === 0}
                  />
                  <PricingRow
                    label="Cache"
                    perMillion={cachePrice}
                    isFree={isFree && cachePrice === 0}
                  />
                </div>
                {isFree && (
                  <div className="mt-4 flex items-start gap-2 text-sm text-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 p-3 rounded-md border border-emerald-200 dark:border-emerald-900">
                    <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>
                      This model is genuinely free. XYZ cost = 0 per request (unless an explicit
                      platform resource cost is configured).
                    </span>
                  </div>
                )}
                {!isFree && (inPrice == null || outPrice == null) && (
                  <div className="mt-4 flex items-start gap-2 text-sm text-amber-700 bg-amber-50 dark:bg-amber-950/30 p-3 rounded-md border border-amber-200 dark:border-amber-900">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>
                      Pricing is not documented by the provider. We will never silently invent a
                      price — XYZ billing is disabled for this model until pricing is established.
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* XYZ cost breakdown */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">XYZ Cost</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Reference request</span>
                    <span className="font-mono text-foreground">
                      {refIn.toLocaleString()} in / {refOut.toLocaleString()} out
                    </span>
                  </div>
                  {refUsdCost != null ? (
                    <>
                      <div className="flex justify-between gap-3">
                        <span className="text-muted-foreground">USD cost (reference)</span>
                        <span className="font-mono text-foreground">
                          {formatUsd(refUsdCost)}
                        </span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-muted-foreground">XYZ cost (reference)</span>
                        <span className="font-mono text-foreground">
                          {refXyzCost?.toFixed(6)} XYZ
                        </span>
                      </div>
                      <div className="flex justify-between gap-3 pt-2 border-t">
                        <span className="text-muted-foreground">~Responses per 1 XYZ</span>
                        <span className="font-mono text-emerald-700 font-semibold">
                          {responsesPerXyz === Infinity
                            ? "∞"
                            : responsesPerXyz != null
                              ? `~${Math.floor(responsesPerXyz)}`
                              : "—"}
                        </span>
                      </div>
                    </>
                  ) : (
                    <p className="text-muted-foreground italic">
                      Pricing not documented — XYZ cost cannot be calculated.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right column: actions + metadata */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Try it</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button asChild className="w-full" size="lg">
                  <Link href={`/chat?model=${encodeURIComponent(model.id)}`}>
                    <MessageSquare className="h-4 w-4 mr-2" />
                    Open in Playground
                  </Link>
                </Button>
                {model.source === "gratisfy" && (
                  <Button asChild variant="outline" className="w-full">
                    <Link href="/settings">
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Configure Gratisfy key
                    </Link>
                  </Button>
                )}
                {model.source === "g4f" && (
                  <Button asChild variant="outline" className="w-full">
                    <Link href="/settings">
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Configure G4F key
                    </Link>
                  </Button>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Metadata</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <MetaRow label="Source" value={model.source} />
                <MetaRow label="Provider" value={model.provider} />
                <MetaRow label="Original ID" value={model.originalModelId} mono />
                <MetaRow
                  label="Streaming"
                  value={model.streaming ? "Supported" : "Not supported"}
                />
                <MetaRow
                  label="Available"
                  value={model.available ? "Yes" : "No"}
                />
                {model.discoveredAt && (
                  <MetaRow
                    label="Discovered"
                    value={new Date(model.discoveredAt).toLocaleString()}
                  />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Pricing source legend</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs text-muted-foreground">
                <div>
                  <span className="font-medium text-emerald-700">Provider</span> — Upstream documented
                </div>
                <div>
                  <span className="font-medium text-slate-700">Market</span> — Supplied baseline
                </div>
                <div>
                  <span className="font-medium text-amber-700">Undocumented</span> — No reliable price
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function PricingRow({
  label,
  perMillion,
  isFree,
}: {
  label: string;
  perMillion: number | null | undefined;
  isFree: boolean;
}) {
  return (
    <div className="flex justify-between items-center gap-3 min-w-0">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span
        className="font-mono text-foreground text-right"
        style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
      >
        {perMillion == null
          ? "Not documented"
          : isFree
            ? "Free"
            : `${formatUsd(perMillion)} / 1M`}
      </span>
    </div>
  );
}

function MetaRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between items-center gap-3 min-w-0">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span
        className={`text-foreground text-right min-w-0 ${mono ? "font-mono text-xs" : ""}`}
        style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
      >
        {value}
      </span>
    </div>
  );
}

async function getSessionUserIdSafe(): Promise<string | null> {
  try {
    // We can't easily get the request object here in an RSC — but we can
    // access cookies via next/headers. For now, return null — the model
    // resolution falls back to native + g4f which doesn't require a user.
    return null;
  } catch {
    return null;
  }
}

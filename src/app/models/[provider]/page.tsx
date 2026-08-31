import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies, headers } from "next/headers";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";

import { Nav } from "@/components/nav";
import { SiteFooter } from "@/components/site";
import {
  ProviderModelsClient,
  type ProviderModelEntry,
} from "@/components/explorer/provider-models-client";

import {
  getUnifiedModels,
  getSessionUserId,
  XYZ_USD_MULTIPLIER,
} from "@/lib/xyz";
import type { Source, UnifiedModel } from "@/lib/xyz/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

// ─── Provider label helpers ──────────────────────────────────────────────────

/**
 * Resolve the human-readable label for a provider segment.
 *
 * Native providers are short codes ("tb", "au", "fx"…) → uppercased.
 * BYOK sources use their friendly source name. The "provider" segment
 * from the URL can be either an actual provider code (e.g. "openai"
 * under gratisfy) OR a source name ("gratisfy", "native"). The
 * catalog collapses gratisfy sub-providers into a single "gratisfy"
 * section, so we try the source-name match first; otherwise we match
 * by m.provider.
 */
function resolveProviderLabel(
  providerSeg: string,
  matchedSource: Source,
  matchedProvider: string | null,
): string {
  if (matchedSource === "native") {
    return (matchedProvider ?? providerSeg).toUpperCase();
  }
  if (matchedSource === "pollinations") {
    if (providerSeg.toLowerCase() === "pollinations") return "Pollinations";
    return providerSeg;
  }
  if (matchedSource === "gratisfy") return "Gratisfy";
  return providerSeg;
}

// ─── Page params type ───────────────────────────────────────────────────────

interface PageProps {
  params: Promise<{ provider: string }>;
}

// ─── Metadata (SEO) ──────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { provider } = await params;
  let providerSeg = provider;
  try {
    providerSeg = decodeURIComponent(provider);
  } catch {
    /* keep raw */
  }
  return {
    title: `${providerSeg.toUpperCase()} — FreeAIXYZ Models`,
    description: `All live models discovered under ${providerSeg} on FreeAIXYZ — capability badges, per-model pricing, and direct copy of the canonical model id.`,
  };
}

// ─── Page component ──────────────────────────────────────────────────────────

export default async function ProviderModelsPage({ params }: PageProps) {
  const { provider } = await params;
  let providerSeg = provider;
  try {
    providerSeg = decodeURIComponent(provider);
  } catch {
    /* keep raw */
  }

  // Resolve the user (best-effort — only needed for gratisfy model lookups).
  const headerStore = await headers();
  const cookieStore = await cookies();
  const url =
    headerStore.get("x-url") ||
    `http://localhost:3000/models/${providerSeg}`;
  const request = new Request(url, {
    headers: { cookie: cookieStore.toString() },
  });
  const userId = await getSessionUserId(request);

  const { models, stale } = await getUnifiedModels(userId ?? undefined);
  const lower = providerSeg.toLowerCase();

  // Match strategy:
  //   1. Exact source-name match ("gratisfy" / "pollinations" / "native") —
  //      used by the catalog's sectionId collapsed tabs.
  //   2. Otherwise, match by m.provider code (e.g. "tb", "openai").
  // If both turn up empty, 404.
  let matchedSource: Source | null = null;
  let matchedProvider: string | null = null;
  let matched: UnifiedModel[] = [];

  if (
    lower === "gratisfy" ||
    lower === "pollinations" ||
    lower === "native"
  ) {
    const src = lower as Source;
    const list = models.filter((m) => m.source === src && m.available);
    if (list.length > 0) {
      matchedSource = src;
      matchedProvider = src;
      matched = list;
    }
  }

  if (matched.length === 0) {
    const list = models.filter(
      (m) => m.provider.toLowerCase() === lower && m.available,
    );
    if (list.length === 0) {
      notFound();
    }
    matchedSource = list[0]!.source;
    matchedProvider = list[0]!.provider;
    matched = list;
  }

  // Map to the JSON-serializable entry shape the client component expects.
  const entries: ProviderModelEntry[] = matched.map((m) => ({
    id: m.id,
    displayName: m.displayName,
    source: m.source,
    provider: m.provider,
    originalModelId: m.originalModelId,
    streaming: m.streaming,
    available: m.available,
    capabilities: m.capabilities,
    pricing: m.pricing,
    discoveredAt: m.discoveredAt,
  }));

  const multiplier = XYZ_USD_MULTIPLIER || 1;
  const providerLabel = resolveProviderLabel(
    providerSeg,
    matchedSource!,
    matchedProvider,
  );

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Nav />

      <main className="flex-1 mx-auto max-w-7xl w-full px-4 sm:px-6 py-8 sm:py-12 flex flex-col gap-6 min-w-0">
        {/* Back link */}
        <Link
          href="/models"
          className="inline-flex items-center gap-1.5 text-xs uppercase tracking-[0.15em] text-muted-foreground hover:text-foreground transition-colors self-start"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All models
        </Link>

        <ProviderModelsClient
          provider={matchedProvider ?? providerSeg}
          providerLabel={providerLabel}
          source={matchedSource!}
          models={entries}
          multiplier={multiplier}
          stale={stale}
        />
      </main>

      <SiteFooter>
        <span
          className="font-mono"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          GET /api/v1/models/unified · filter by provider
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

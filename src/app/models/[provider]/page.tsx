import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, AlertTriangle } from "lucide-react";

import { AuroraShell } from "@/components/aurora/shell";
import { FleetCard } from "@/components/explorer/fleet-card";
import {
  FLEET_GROUP_META,
  fleetGroupLabel,
  isFleetGroupSlug,
} from "@/components/explorer/fleet-meta";
import {
  FLEET_CATALOG,
  fleetByGroup,
  type FleetCatalogModel,
} from "@/lib/native-catalog";

export const dynamic = "force-static";

// ─── Page params type ───────────────────────────────────────────────────────

interface PageProps {
  params: Promise<{ provider: string }>;
}

// ─── Metadata (SEO) ──────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { provider } = await params;
  const slug = decodeParam(provider);
  if (!isFleetGroupSlug(slug)) {
    return { title: "Models — FreeAIXYZ" };
  }
  const label = fleetGroupLabel(slug);
  return {
    title: `${label} — FreeAIXYZ Models`,
    description: `The ${label} line of the Onyx AI fleet — ${fleetByGroup(slug).length} free models with capability badges and one-click chat. No API key required.`,
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
 * /models/[provider] — a single Onyx fleet line.
 *
 * The slug accepts ONLY the three fleet-group slugs ("uncensored",
 * "general", "creative"). Any other slug — legacy provider ids like "tb" or
 * "nsfwgirlfriend" — redirects to /models (those routes are no longer a
 * public surface).
 */
export default async function FleetGroupPage({ params }: PageProps) {
  const { provider } = await params;
  const slug = decodeParam(provider);

  if (!isFleetGroupSlug(slug)) {
    redirect("/models");
  }

  const label = fleetGroupLabel(slug);
  const meta = FLEET_GROUP_META.find((g) => g.slug === slug);

  const models: readonly FleetCatalogModel[] = fleetByGroup(slug);
  if (models.length === 0) {
    redirect("/models");
  }

  const entries = models.map((m) => ({
    id: m.id,
    name: m.name,
    brief: m.brief,
    description: m.description,
    group: m.group,
    uncensored: m.uncensored,
    providerName: m.providerName,
    capabilities: {
      streaming: m.capabilities.streaming,
      reasoning: m.capabilities.reasoning,
      vision: m.capabilities.vision,
      tools: m.capabilities.tools,
      webSearch: m.capabilities.webSearch,
      multiTurn: m.capabilities.multiTurn,
      systemPrompt: m.capabilities.systemPrompt,
    },
    contextWindow: m.contextWindow,
  }));

  return (
    <AuroraShell>
      <div className="pt-10 sm:pt-14 flex flex-col gap-6 min-w-0">
        {/* Breadcrumb */}
        <div>
          <Link
            href="/models"
            className="font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground hover:text-white transition-colors inline-flex items-center gap-1.5"
          >
            <ArrowLeft className="h-3 w-3" />
            All models
          </Link>
        </div>

        {/* Header */}
        <header className="flex flex-col gap-3 min-w-0">
          <span className="fxz-section-eyebrow">FreeAIXYZ // {meta?.shortLabel ?? label}</span>
          <div className="flex flex-wrap items-center gap-3">
            <h1
              className="fxz-page-title min-w-0"
              style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
            >
              {label}
            </h1>
            {slug === "uncensored" && (
              <span
                className="fxz-badge-nsfw gap-1.5"
                title="Every slot in this line passed a live uncensored hard-test battery"
              >
                <AlertTriangle className="h-3 w-3" aria-hidden />
                18+ · adults only
              </span>
            )}
          </div>
          <p className="text-[15px] text-muted-foreground max-w-2xl leading-relaxed">
            {slug === "uncensored"
              ? "Adults only. Every slot in this line passed a live uncensored hard-test battery — verified 18+, explicit content, zero refusals."
              : `${models.length} free Onyx AI fleet models in the ${label.toLowerCase()} line — one OpenAI-compatible endpoint, no API key required.`}{" "}
            Served by Onyx AI.
          </p>
          <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
            {models.length} model{models.length === 1 ? "" : "s"} · onyx fleet
          </span>
        </header>

        {/* Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {entries.map((m, mi) => (
            <FleetCard key={m.id} m={m} emberRim={mi % 2 === 1} />
          ))}
        </div>
      </div>
    </AuroraShell>
  );
}

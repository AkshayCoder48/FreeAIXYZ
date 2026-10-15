import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, AlertTriangle, Boxes } from "lucide-react";

import { AuroraShell } from "@/components/aurora/shell";
import { FleetCard } from "@/components/explorer/fleet-card";
import {
  fleetFamily,
  fleetCategoryLabel,
  isFleetFamilySlug,
  type CatalogFleetModel,
} from "@/components/explorer/fleet-meta";
import {
  fleetByFamily,
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
  if (!isFleetFamilySlug(slug)) {
    return { title: "Models — FreeAIXYZ" };
  }
  const family = fleetFamily(slug);
  return {
    title: `${family.name} — FreeAIXYZ Models`,
    description: `The ${family.name} family of the Onyx AI fleet — ${fleetByFamily(slug).length} free models. ${family.tagline}. No API key required.`,
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
 * /models/[provider] — a single Onyx fleet FAMILY.
 *
 * The slug accepts ONLY the ten family slugs ("astra" … "zenith"). Legacy
 * three-line group slugs ("uncensored", "general", "creative") and old
 * provider ids redirect to /models — those routes are no longer a public
 * surface. Families with no public models yet (RIVEN, ZENITH) render an
 * honest empty state.
 */
export default async function FleetFamilyPage({ params }: PageProps) {
  const { provider } = await params;
  const slug = decodeParam(provider);

  if (!isFleetFamilySlug(slug)) {
    // Legacy three-line groups: "uncensored" mapped 1:1 onto the AMORA
    // family, so old links keep landing somewhere useful. The other legacy
    // groups spanned multiple families — they redirect to the full catalog.
    if (slug === "uncensored") redirect("/models/amora");
    redirect("/models");
  }

  const family = fleetFamily(slug);
  const models: readonly FleetCatalogModel[] = fleetByFamily(slug);

  const entries: CatalogFleetModel[] = models.map((m) => ({
    id: m.id,
    legacyIds: m.legacyIds,
    name: m.name,
    family: m.family,
    familyName: m.familyName,
    variant: m.variant,
    version: m.version,
    releaseOrder: m.releaseOrder,
    category: m.category,
    contentClassification: m.contentClassification,
    brief: m.brief,
    description: m.description,
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
          <span className="fxz-section-eyebrow">
            FreeAIXYZ // {family.index} · {fleetCategoryLabel(family.category)}
          </span>
          <div className="flex flex-wrap items-center gap-3">
            <h1
              className="fxz-page-title min-w-0"
              style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
            >
              {family.name}
            </h1>
            {family.adult && (
              <span
                className="fxz-badge-nsfw gap-1.5"
                title="Every slot in this family passed a live uncensored hard-test battery"
              >
                <AlertTriangle className="h-3 w-3" aria-hidden />
                18+ · adults only
              </span>
            )}
          </div>
          <p className="text-[15px] text-muted-foreground max-w-2xl leading-relaxed">
            {family.description}
          </p>
          <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
            {models.length > 0
              ? `${models.length} model${models.length === 1 ? "" : "s"} · onyx fleet`
              : "no public models yet · onyx fleet"}
          </span>
        </header>

        {/* Grid or honest empty state */}
        {entries.length === 0 ? (
          <div className="fxz-panel rounded-xl p-8 flex items-center gap-4 text-muted-foreground">
            <Boxes className="h-5 w-5 text-hd-line shrink-0" aria-hidden />
            <p className="text-sm leading-relaxed">
              The {family.name} family is defined in the registry — no public
              models have been released in it yet. Placeholder models are
              never listed.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {entries.map((m, mi) => (
              <FleetCard key={m.id} m={m} emberRim={mi % 2 === 1} />
            ))}
          </div>
        )}
      </div>
    </AuroraShell>
  );
}

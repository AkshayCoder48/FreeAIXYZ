import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";

import { Nav } from "@/components/nav";
import { SiteFooter } from "@/components/site";
import {
  ProviderModelsClient,
  type ProviderModelEntry,
} from "@/components/explorer/provider-models-client";
import { OFFERED_MODELS, NATIVE_PROVIDERS } from "@/lib/native-catalog";

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
  const id = decodeProvider(provider);
  const entry = NATIVE_PROVIDERS.find((p) => p.id === id || p.shortId === id);
  return {
    title: `${entry?.name ?? id} — FreeAIXYZ Models`,
    description: `All native models under ${entry?.name ?? id} — capability badges and direct copy of the canonical model id.`,
  };
}

function decodeProvider(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

// ─── Page component ──────────────────────────────────────────────────────────

export default async function ProviderModelsPage({ params }: PageProps) {
  const { provider } = await params;
  const idOrShort = decodeProvider(provider);

  // Accept either the full provider id or its short id.
  const providerEntry = NATIVE_PROVIDERS.find(
    (p) => p.id === idOrShort || p.shortId === idOrShort,
  );
  if (!providerEntry) notFound();

  const models = OFFERED_MODELS.filter(
    (m) => m.providerId === providerEntry.id,
  );
  if (models.length === 0) notFound();

  const entries: ProviderModelEntry[] = models.map((m) => ({
    id: m.id,
    name: m.name,
    providerId: m.providerId,
    providerName: m.providerName,
    description: m.description,
    capabilities: {
      streaming: m.capabilities.streaming,
      reasoning: m.capabilities.reasoning,
      vision: m.capabilities.vision,
      tools: m.capabilities.tools,
      webSearch: m.capabilities.webSearch,
    },
    contextWindow: m.contextWindow,
  }));

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Nav />

      <main className="flex-1 mx-auto max-w-7xl w-full px-4 sm:px-6 py-8 sm:py-12 flex flex-col gap-6">
        <div>
          <Link
            href="/models"
            className="text-xs uppercase tracking-[0.15em] text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1.5"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            <ArrowLeft className="h-3 w-3" />
            All models
          </Link>
        </div>
        <ProviderModelsClient
          providerLabel={providerEntry.name}
          models={entries}
        />
      </main>

      <SiteFooter>
        <span>
          {providerEntry.name} · native models · static registry
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

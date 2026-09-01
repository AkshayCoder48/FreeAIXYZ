import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";

import { AuroraShell } from "@/components/aurora/shell";
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
    <AuroraShell>
      <div className="pt-10 sm:pt-14 flex flex-col gap-6 min-w-0">
        <div>
          <Link
            href="/models"
            className="text-xs uppercase tracking-[0.15em] text-[#9c9c9d] hover:text-white transition-colors inline-flex items-center gap-1.5"
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
      </div>
    </AuroraShell>
  );
}

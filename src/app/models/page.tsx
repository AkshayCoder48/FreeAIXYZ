import {
  AuroraShell,
} from "@/components/aurora/shell";
import {
  ModelsCatalog,
  type ModelsCatalogData,
} from "@/components/explorer/models-catalog";
import { FLEET_CATALOG, type FleetCatalogModel } from "@/lib/native-catalog";

// Pure static content (no dynamic APIs, no fetches) — prerendered at build
// time and served from the CDN edge. Explicit for honesty (perf pass 3-perf).
export const dynamic = "force-static";

export const metadata = {
  title: "Models — FreeAIXYZ",
  description:
    "The Onyx AI fleet: 24 free models across three lines — Uncensored (18+), General and Creative. Streaming, reasoning, tools, web search. No API key required.",
};

/**
 * /models page (FreeAIXYZ design).
 *
 * The ONLY public model surface. Built entirely from the static Onyx fleet
 * catalog (FLEET_CATALOG): clean display names, onyx-* ids as mono pills,
 * "Onyx AI" attribution everywhere. Provider-prefixed routes are never
 * listed — the underlying registry stays internal.
 */
export default function ModelsPage() {
  const data: ModelsCatalogData = {
    models: FLEET_CATALOG.map((m: FleetCatalogModel) => ({
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
    })),
  };

  return (
    <AuroraShell>
      <div className="pt-10 sm:pt-14 min-w-0">
        <ModelsCatalog data={data} />
      </div>
    </AuroraShell>
  );
}

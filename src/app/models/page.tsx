import {
  AuroraShell,
} from "@/components/aurora/shell";
import {
  ModelsCatalog,
  type ModelsCatalogData,
} from "@/components/explorer/models-catalog";
import {
  OFFERED_MODELS,
  NATIVE_PROVIDERS,
  type NativeModel,
} from "@/lib/native-catalog";

// Pure static content (no dynamic APIs, no fetches) — prerendered at build
// time and served from the CDN edge. Explicit for honesty (perf pass 3-perf).
export const dynamic = "force-static";

export const metadata = {
  title: "Models — HyperDimension AI",
  description:
    "Searchable catalog of every native model, grouped by provider with capability badges. Static registry, no API key required.",
};

/**
 * /models page (HyperDimension AI "Crimson Orb" design).
 *
 * Layout: page title + search → provider filter tabs → provider sections,
 * each containing a responsive grid (1 / 2 / 3 cols) of obsidian model
 * cards with crimson/ember rims and mono capability badges.
 *
 * Data comes from the STATIC native registry (bundled at build time) —
 * the interactive catalog receives it via props; it never fetches.
 */
export default function ModelsPage() {
  const data: ModelsCatalogData = {
    models: OFFERED_MODELS.map((m: NativeModel) => ({
      id: m.id,
      name: m.name,
      providerId: m.providerId,
      providerName: m.providerName,
      description: m.description,
      category: m.category,
      capabilities: {
        streaming: m.capabilities.streaming,
        reasoning: m.capabilities.reasoning,
        vision: m.capabilities.vision,
        tools: m.capabilities.tools,
        webSearch: m.capabilities.webSearch,
      },
      contextWindow: m.contextWindow,
    })),
    providers: NATIVE_PROVIDERS.map((p) => ({
      id: p.id,
      shortId: p.shortId,
      name: p.name,
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

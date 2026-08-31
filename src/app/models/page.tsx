import { Nav } from "@/components/nav";
import { SiteFooter } from "@/components/site";
import {
  ModelsCatalog,
  type ModelsCatalogData,
} from "@/components/explorer/models-catalog";
import {
  OFFERED_MODELS,
  NATIVE_PROVIDERS,
  type NativeModel,
} from "@/lib/native-catalog";

export const metadata = {
  title: "Models — FreeAIXYZ",
  description:
    "Searchable catalog of every native model, grouped by provider with capability badges. Static registry, no API key required.",
};

/**
 * /models page.
 *
 * Layout: page title + search → provider filter tabs → provider sections,
 * each containing a responsive grid (1 / 2 / 3 cols) of model cards.
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
    <div className="min-h-screen flex flex-col bg-background">
      <Nav />

      <main className="flex-1 mx-auto max-w-7xl w-full px-4 sm:px-6 py-8 sm:py-12">
        <ModelsCatalog data={data} />
      </main>

      <SiteFooter>
        <span>Models · grouped by provider · capability-aware</span>
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

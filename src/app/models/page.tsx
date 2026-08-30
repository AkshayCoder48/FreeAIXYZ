import { Nav } from "@/components/nav";
import { SiteFooter } from "@/components/site";
import { ModelsCatalog } from "@/components/explorer/models-catalog";

export const metadata = {
  title: "Models — FreeAIXYZ",
  description:
    "Searchable catalog of every discovered model, grouped by provider with capability badges, pricing, and health status.",
};

/**
 * /models page (PRD §29, §30, §31, §78).
 *
 * Layout: page title + search → provider filter tabs → provider sections,
 * each containing a responsive grid (1 / 2 / 3 / 4 cols) of provider cards.
 *
 * The interactive catalog (`<ModelsCatalog />`) is a client component that
 * fetches `/api/v1/models/unified` + `/api/v1/pricing` and renders cards
 * using NORMAL DOCUMENT FLOW (flex column, no absolute positioning) so
 * long model ids + capability badges + the model selector never overflow
 * the card boundary.
 */
export default function ModelsPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Nav />

      <main className="flex-1 mx-auto max-w-7xl w-full px-4 sm:px-6 py-8 sm:py-12">
        <ModelsCatalog />
      </main>

      <SiteFooter>
        <span>Models · grouped by provider · capability-aware</span>
        <span
          className="font-mono"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          GET /api/v1/models/unified
        </span>
      </SiteFooter>
    </div>
  );
}

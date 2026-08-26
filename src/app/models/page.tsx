import { Nav } from "@/components/nav";
import { ModelExplorer } from "@/components/explorer/model-explorer";
import { SectionLabel, SiteFooter, FadeIn } from "@/components/site";

export const metadata = {
  title: "Models — FreeAIXYZ",
  description:
    "Searchable catalog of every discovered model with provider filters, capability badges, and health status.",
};

export default function ModelsPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Nav />

      <main className="flex-1 mx-auto max-w-7xl w-full px-4 sm:px-6 py-8 sm:py-12">
        <FadeIn className="mb-8 flex flex-col gap-3">
          <SectionLabel>Model catalog</SectionLabel>
          <h1 className="text-4xl sm:text-5xl font-normal tracking-tight text-foreground mt-2">
            Every model, by canonical{" "}
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-[#0052FF] to-[#4D7CFF]">
              id
            </span>
            .
          </h1>
          <p className="text-sm text-muted-foreground max-w-3xl leading-relaxed">
            Every model is exposed as{" "}
            <code
              className="font-mono text-accent bg-accent/5 px-1.5 py-0.5 rounded-md text-xs"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >
              shortId/originalModelId
            </code>{" "}
            — the provider&apos;s exact upstream identifier, prefixed with a
            stable short provider id to prevent collisions. No custom marketing
            names. Catalogs are fetched at startup from each provider&apos;s{" "}
            <code
              className="font-mono text-accent"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >
              /models
            </code>{" "}
            endpoint where supported; manual-mode providers fall back to a
            curated list.
          </p>
        </FadeIn>

        <ModelExplorer />
      </main>

      <SiteFooter>
        <span>
          Canonical ids ·{" "}
          <code
            className="font-mono text-accent"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            fg/gpt-5
          </code>{" "}
          ·{" "}
          <code
            className="font-mono text-accent"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            po/openai-fast
          </code>
        </span>
        <span
          className="font-mono"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          POST /api/discovery/refresh
        </span>
      </SiteFooter>
    </div>
  );
}

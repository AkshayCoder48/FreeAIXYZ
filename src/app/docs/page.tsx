import type { Metadata } from "next";

import { AuroraShell } from "@/components/aurora/shell";
import { DocsBrowser } from "@/components/docs/docs-browser";
import { DOC_PAGES } from "@/lib/docs/content";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Docs — HyperDimension AI",
  description:
    "The complete HyperDimension AI (FreeAIXYZ) documentation: quickstart, streaming SSE format, the tool-calling pipeline, the full API reference, built-in tools, error codes, examples, FAQ and changelog.",
  keywords: [
    "FreeAIXYZ docs",
    "HyperDimension AI docs",
    "free AI API documentation",
    "OpenAI compatible API docs",
    "tool calling guide",
    "SSE streaming guide",
  ],
};

/**
 * /docs — the documentation section (HyperDimension "Crimson Orb" design).
 *
 * RSC shell; the interactive browser (hash-routed pages, sidebar search,
 * on-this-page TOC, prev/next pager) is the client island. Content is the
 * static build-time tree in src/lib/docs/content.ts — 21 pages, 5 groups.
 */
export default function DocsPage() {
  return (
    <AuroraShell
      footer={
        <div className="mx-auto max-w-6xl px-6 pb-4 -mt-3">
          <span className="font-mono text-[10.5px] text-muted-foreground">
            {DOC_PAGES.length} pages · updated with every deploy
          </span>
        </div>
      }
    >
      <DocsBrowser />
    </AuroraShell>
  );
}

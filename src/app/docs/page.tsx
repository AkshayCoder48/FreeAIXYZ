import type { Metadata } from "next";

import { AuroraShell } from "@/components/aurora/shell";
import { DocsBrowser } from "@/components/docs/docs-browser";
import { DOC_PAGES } from "@/lib/docs/content";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Docs — FreeAIXYZ",
  description:
    "The complete FreeAIXYZ documentation: quickstart, streaming SSE format, the tool-calling pipeline, the full API reference, built-in tools, error codes, examples, FAQ and changelog.",
  keywords: [
    "FreeAIXYZ docs",
    "free AI API documentation",
    "OpenAI compatible API docs",
    "tool calling guide",
    "SSE streaming guide",
  ],
};

/**
 * /docs — the documentation section (WARM AURORA design).
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
          <span
            className="text-[10.5px] text-[#7c7c7f]"
            style={{ fontFamily: "var(--font-mono), ui-monospace, monospace" }}
          >
            {DOC_PAGES.length} pages · updated with every deploy
          </span>
        </div>
      }
    >
      <DocsBrowser />
    </AuroraShell>
  );
}

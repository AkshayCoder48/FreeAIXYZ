"use client";

/**
 * DocsBrowser — the interactive /docs surface (WARM AURORA design).
 *
 * Layout (lg+):  sidebar (search + grouped nav)  │  content (one page)
 *               plus a right "On this page" mini-TOC on xl+.
 * Mobile: the sidebar becomes a collapsible "Contents" drawer.
 *
 * Navigation model: hash-based single-page routing — `#doc-<pageId>` selects
 * the active page from DOC_PAGES. The browser back/forward buttons, sidebar
 * clicks and in-content links all drive the same hash. Prev/next pager cards
 * walk the flat page order.
 *
 * Everything renders in the shared design language: dark-glass panels, warm
 * hairlines, mono eyebrows, keycap accents — strictly warm, no blue/purple.
 */

import * as React from "react";
import Link from "next/link";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  List,
  X,
  Rocket,
  BookOpen,
  Braces,
  Wrench,
  Library,
  Menu,
} from "lucide-react";
import { DOC_GROUPS, DOC_PAGES, type DocPage } from "@/lib/docs/content";
import { DocBlockView, slugify } from "@/components/docs/blocks";
import { cn } from "@/lib/utils";

const GROUP_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "getting-started": Rocket,
  guides: BookOpen,
  api: Braces,
  tools: Wrench,
  resources: Library,
};

/** Pages in display order (content.ts order is the canonical order). */
const FLAT_PAGES = DOC_PAGES;

function pageFromHash(hash: string): DocPage | null {
  const id = hash.replace(/^#doc-/, "");
  return DOC_PAGES.find((p) => p.id === id) ?? null;
}

function hashForPage(page: DocPage): string {
  return `#doc-${page.id}`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function DocsBrowser() {
  // Initial state must match SSR (page 1) — hash-based deep links are
  // resolved in a mount effect to avoid hydration mismatches.
  const [page, setPage] = React.useState<DocPage>(() => FLAT_PAGES[0]);
  const [query, setQuery] = React.useState("");
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const [mobileTocOpen, setMobileTocOpen] = React.useState(false);
  const contentRef = React.useRef<HTMLDivElement>(null);

  // ── Hash routing: deep links, back/forward + in-content links. ──
  React.useEffect(() => {
    const onHashChange = () => {
      const next = pageFromHash(window.location.hash);
      if (next) setPage(next);
    };
    onHashChange(); // resolve the initial deep link (e.g. /docs#doc-streaming)
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Scroll to top whenever the active page changes.
  React.useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
    setMobileNavOpen(false);
    setMobileTocOpen(false);
  }, [page.id]);

  const navigate = React.useCallback((target: DocPage) => {
    if (target.id === page.id) {
      // same page — just scroll to top (hash already correct)
      window.scrollTo({ top: 0, behavior: "smooth" });
      setMobileNavOpen(false);
      return;
    }
    // Setting location.hash triggers hashchange → setPage. If the hash is
    // somehow already set (skeleton nav), set state directly too.
    window.location.hash = hashForPage(target);
    setPage(target);
  }, [page.id]);

  // ── Sidebar search filter. ──
  const q = query.trim().toLowerCase();
  const filteredPages = React.useMemo(
    () =>
      q
        ? FLAT_PAGES.filter(
            (p) =>
              p.title.toLowerCase().includes(q) ||
              p.description.toLowerCase().includes(q) ||
              (p.keywords ?? []).some((k) => k.includes(q)),
          )
        : FLAT_PAGES,
    [q],
  );

  const pageIndex = FLAT_PAGES.findIndex((p) => p.id === page.id);
  const prev = pageIndex > 0 ? FLAT_PAGES[pageIndex - 1] : null;
  const next =
    pageIndex >= 0 && pageIndex < FLAT_PAGES.length - 1
      ? FLAT_PAGES[pageIndex + 1]
      : null;

  // "On this page" — the h3 headings of the current page.
  const headings = React.useMemo(
    () =>
      page.blocks
        .filter((b): b is { kind: "h3"; text: string } => b.kind === "h3")
        .map((b) => ({ text: b.text, id: slugify(b.text) })),
    [page],
  );

  return (
    <div className="pt-10 sm:pt-14 flex flex-col gap-6 min-w-0">
      {/* ── Page header ── */}
      <div className="flex flex-col gap-3 fxz-fade-up">
        <span className="fxz-section-eyebrow">Documentation</span>
        <h1 className="fxz-page-title max-w-3xl">
          Everything, <span className="fxz-gradient-word">documented</span>.
        </h1>
        <p className="text-[15px] leading-relaxed text-[#9c9c9d] max-w-2xl">
          {FLAT_PAGES.length} pages across {DOC_GROUPS.length} sections — the
          API, the streaming wire format, the tool-calling pipeline, every
          built-in tool, every error code, and a full cookbook. No key, no
          account, no gate.
        </p>
      </div>

      {/* ── Mobile: contents drawer toggle ── */}
      <div className="lg:hidden flex items-center gap-2">
        <button
          type="button"
          onClick={() => setMobileNavOpen((v) => !v)}
          className="fxz-chip"
          aria-expanded={mobileNavOpen}
          aria-controls="docs-sidebar"
        >
          {mobileNavOpen ? (
            <X className="h-3.5 w-3.5" />
          ) : (
            <Menu className="h-3.5 w-3.5" />
          )}
          Contents
        </button>
        {headings.length > 0 && (
          <button
            type="button"
            onClick={() => setMobileTocOpen((v) => !v)}
            className="fxz-chip"
            aria-expanded={mobileTocOpen}
            aria-controls="docs-toc"
          >
            <List className="h-3.5 w-3.5" />
            On this page
          </button>
        )}
      </div>

      {/* ── 3-column body: sidebar │ content │ toc ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[250px_minmax(0,1fr)] xl:grid-cols-[250px_minmax(0,1fr)_210px] gap-8 items-start min-w-0">

        {/* ═══ Sidebar ═══ */}
        <aside
          id="docs-sidebar"
          className={cn(
            "lg:sticky lg:top-24 lg:block lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto custom-scroll",
            mobileNavOpen ? "block" : "hidden",
          )}
          aria-label="Docs navigation"
        >
          {/* Search */}
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#7c7c7f] pointer-events-none" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter pages…"
              className="fxz-input w-full rounded-lg pl-9 pr-3 h-9 text-[13px] outline-none"
              aria-label="Filter documentation pages"
            />
          </div>

          <nav className="flex flex-col gap-5">
            {DOC_GROUPS.map((group) => {
              const items = filteredPages.filter((p) => p.group === group.id);
              if (items.length === 0) return null;
              const Icon = GROUP_ICONS[group.id] ?? BookOpen;
              return (
                <div key={group.id} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2 px-2 mb-1.5">
                    <Icon className="h-3 w-3 text-[#ff6b4a]" />
                    <span className="fxz-docs-group-label">{group.label}</span>
                  </div>
                  {items.map((p) => {
                    const active = p.id === page.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => navigate(p)}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "fxz-docs-navitem",
                          active && "fxz-docs-navitem-active",
                        )}
                      >
                        <span className="truncate">{p.title}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
            {filteredPages.length === 0 && (
              <p className="px-2 text-xs text-[#7c7c7f]">
                No pages match “{query}”.
              </p>
            )}
          </nav>

          {/* Sidebar footer */}
          <div className="mt-6 pt-4 border-t border-white/[0.06] px-2">
            <p
              className="text-[10px] text-[#7c7c7f] leading-relaxed"
              style={{ fontFamily: "var(--font-mono), ui-monospace, monospace" }}
            >
              {FLAT_PAGES.length} pages · {DOC_GROUPS.length} sections
              <br />
              page {pageIndex + 1} of {FLAT_PAGES.length}
            </p>
          </div>
        </aside>

        {/* ═══ Content ═══ */}
        <article ref={contentRef} className="min-w-0 fxz-docs-prose">
          {/* Page heading */}
          <header className="mb-6 pb-6 border-b border-white/[0.07] min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="fxz-badge fxz-badge-warm font-mono">
                doc-{page.id}
              </span>
              <span className="text-[11px] text-[#7c7c7f]">
                {DOC_GROUPS.find((g) => g.id === page.group)?.label}
              </span>
            </div>
            <h2
              id={`doc-${page.id}`}
              className="scroll-mt-28"
              style={{ marginBottom: 8 }}
            >
              {page.title}
            </h2>
            <p className="text-[14px] text-[#9c9c9d] leading-relaxed max-w-2xl">
              {page.description}
            </p>
          </header>

          {/* Blocks */}
          <div className="min-w-0">
            {page.blocks.map((block, i) => (
              <DocBlockView key={i} block={block} />
            ))}
          </div>

          {/* Prev / next pager */}
          <nav
            className="mt-14 pt-8 border-t border-white/[0.07] grid grid-cols-1 sm:grid-cols-2 gap-3"
            aria-label="Pager"
          >
            {prev ? (
              <button
                type="button"
                onClick={() => navigate(prev)}
                className="fxz-docs-pager flex items-center gap-3 text-left"
              >
                <ChevronLeft className="h-4 w-4 text-[#ff8a6b] shrink-0" />
                <span className="min-w-0">
                  <span className="block text-[10px] uppercase tracking-[0.15em] text-[#7c7c7f]">
                    Previous
                  </span>
                  <span className="block text-sm font-medium text-white truncate">
                    {prev.title}
                  </span>
                </span>
              </button>
            ) : (
              <span aria-hidden className="hidden sm:block" />
            )}
            {next && (
              <button
                type="button"
                onClick={() => navigate(next)}
                className="fxz-docs-pager flex items-center justify-end gap-3 text-right"
              >
                <span className="min-w-0">
                  <span className="block text-[10px] uppercase tracking-[0.15em] text-[#7c7c7f]">
                    Next
                  </span>
                  <span className="block text-sm font-medium text-white truncate">
                    {next.title}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 text-[#ff8a6b] shrink-0" />
              </button>
            )}
          </nav>

          {/* Cross-links */}
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/chat" className="fxz-ghost-pill">
              Try it in the Playground
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
            <Link href="/models" className="fxz-ghost-pill">
              Browse {`${FLAT_PAGES.length > 0 ? "the catalog" : "models"}`}
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </article>

        {/* ═══ On this page (xl+) ═══ */}
        <aside
          id="docs-toc"
          className={cn(
            "xl:sticky xl:top-24 xl:block max-h-[calc(100vh-7rem)] xl:overflow-y-auto custom-scroll",
            mobileTocOpen ? "block" : "hidden",
          )}
          aria-label="On this page"
        >
          {headings.length > 0 && (
            <div className="flex flex-col gap-2 min-w-0">
              <span className="fxz-docs-group-label px-1">On this page</span>
              {headings.map((h) => (
                <a
                  key={h.id}
                  href={`#${h.id}`}
                  className="block text-[12.5px] leading-snug text-[#9c9c9d] hover:text-[#ff8a6b] transition-colors pl-3 border-l border-white/[0.08] hover:border-[#ff6b4a]/50 truncate"
                >
                  {h.text}
                </a>
              ))}
              <a
                href={`#doc-${page.id}`}
                className="block text-[12.5px] text-[#9c9c9d] hover:text-[#ff8a6b] transition-colors pl-3 border-l border-white/[0.08] hover:border-[#ff6b4a]/50 mt-1"
              >
                ↑ Back to top
              </a>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

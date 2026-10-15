"use client";

/**
 * AuroraShell — the shared app chrome for every content page (playground,
 * models, docs), skinned in the FreeAIXYZ warm crimson/ember design system.
 *
 * Design language:
 *   - ground #111319 with a dim, static crimson bloom + ambient ember
 *     glows pinned behind the content (pure CSS, no canvas on content pages);
 *   - a floating dark-glass PILL NAV (backdrop-blur, crimson hairline,
 *     inner-top highlight) with the glowing glyph + Space Grotesk
 *     wordmark and the mono "Free AI Gateway" tagline;
 *   - JetBrains Mono captions, crimson active states, ember accents;
 *   - strictly WARM — no blue/indigo anywhere.
 *
 * The sticky-footer pattern is preserved: the shell root is
 * `min-h-screen flex flex-col` and the footer uses `mt-auto`, so short pages
 * pin the footer to the viewport bottom while long pages push it down.
 */

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, ArrowRight, MessageSquare, Cpu, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Nav links (the app's three sections + home via the logo) ────────────────

const NAV_LINKS = [
  { href: "/chat", label: "Playground", icon: MessageSquare },
  { href: "/models", label: "Models", icon: Cpu },
  { href: "/docs", label: "Docs", icon: BookOpen },
];

/** Glowing crimson glyph — the FreeAIXYZ brand mark. */
export function AuroraGlyph({ size = 14 }: { size?: number }) {
  return (
    <span
      className="inline-block shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background:
          "radial-gradient(circle at 35% 30%, #fff3e2 0%, #ff850d 30%, #ff2a55 65%, #92002a 100%)",
        boxShadow: "0 0 12px rgba(255,42,85,0.75), 0 0 4px rgba(255,133,13,0.6)",
      }}
      aria-hidden="true"
    />
  );
}

// ─── Floating pill nav ───────────────────────────────────────────────────────

export function AuroraNav() {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  // Close the mobile menu on route change.
  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Close on outside click / Escape.
  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <header className="sticky top-4 z-50 px-4 flex justify-center">
      <div ref={menuRef} className="relative w-full max-w-3xl">
        <nav
          className="flex items-center justify-between rounded-full border border-crimson/25 bg-hd-deep/80 backdrop-blur-xl px-4 sm:px-5 py-2.5"
          style={{
            boxShadow:
              "0 18px 50px -18px rgba(0,0,0,0.9), 0 0 22px rgba(255,42,85,0.14), inset 0 1px 0 rgba(255,255,255,0.07)",
          }}
          aria-label="Main navigation"
        >
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 shrink-0">
            <AuroraGlyph size={16} />
            <span className="flex flex-col leading-none">
              <span className="font-display text-[15px] font-bold tracking-tight text-white">
                FreeAI<span className="text-crimson">XYZ</span>
              </span>
              <span className="font-mono text-[8.5px] uppercase tracking-[0.22em] text-muted-foreground mt-1">
                Free AI Gateway
              </span>
            </span>
          </Link>

          {/* Desktop links */}
          <div className="hidden md:flex items-center gap-6">
            {NAV_LINKS.map(({ href, label, icon: Icon }) => {
              const active = isActive(href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-1.5 text-sm font-medium transition-colors",
                    active
                      ? "text-white"
                      : "text-muted-foreground hover:text-white",
                  )}
                >
                  <Icon
                    className={cn(
                      "h-3.5 w-3.5",
                      active ? "text-crimson" : "text-hd-line",
                    )}
                    strokeWidth={1.75}
                  />
                  {label}
                </Link>
              );
            })}
          </div>

          {/* Right side: CTA + mobile hamburger */}
          <div className="flex items-center gap-3">
            <Link href="/chat" className="fxz-nav-cta hidden sm:inline-flex">
              Open Playground
              <ArrowRight className="h-3 w-3" strokeWidth={2.5} />
            </Link>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="md:hidden inline-flex h-10 w-10 items-center justify-center rounded-full border border-crimson/25 text-muted-foreground hover:text-white transition-colors"
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
            >
              {open ? (
                <X className="h-4 w-4" strokeWidth={1.75} />
              ) : (
                <Menu className="h-4 w-4" strokeWidth={1.75} />
              )}
            </button>
          </div>
        </nav>

        {/* Mobile dropdown (dark glass, crimson active) */}
        {open && (
          <div
            className="md:hidden absolute left-0 right-0 top-[calc(100%+10px)] rounded-2xl border border-crimson/25 bg-hd-deep/90 backdrop-blur-xl p-2"
            style={{
              boxShadow:
                "0 24px 60px -18px rgba(0,0,0,0.95), 0 0 26px rgba(255,42,85,0.16), inset 0 1px 0 rgba(255,255,255,0.06)",
            }}
          >
            {NAV_LINKS.map(({ href, label, icon: Icon }) => {
              const active = isActive(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3.5 py-3 text-sm font-medium transition-colors",
                    active
                      ? "fxz-docs-navitem-active"
                      : "text-muted-foreground hover:text-white hover:bg-white/[0.04]",
                  )}
                >
                  <Icon
                    className={cn(
                      "h-4 w-4",
                      active ? "text-crimson" : "text-hd-line",
                    )}
                    strokeWidth={1.75}
                  />
                  {label}
                </Link>
              );
            })}
            <Link href="/chat" className="fxz-nav-cta mt-2 w-full justify-center">
              Open Playground
              <ArrowRight className="h-3 w-3" strokeWidth={2.5} />
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}

// ─── Fixed FreeAIXYZ backdrop (dimmed for content pages) ────────────────

export function AuroraBackground() {
  return (
    <div aria-hidden className="pointer-events-none">
      <div className="fxz-hd-backdrop" />
      <div className="fxz-hd-backdrop-orb" />
      <div className="fxz-grain fxz-grain-fixed" />
    </div>
  );
}

// ─── Footer (sticky to the bottom via mt-auto) ───────────────────────────────

export function AuroraFooter({ children }: { children?: React.ReactNode }) {
  return (
    <footer className="mt-auto relative z-10 border-t border-crimson/20 bg-hd-deep/80 backdrop-blur-md">
      <div className="mx-auto max-w-6xl px-6 py-7 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-2.5">
          <AuroraGlyph size={10} />
          <span className="text-[#e2e2ea]">
            FreeAIXYZ — free AI gateway
          </span>
        </div>
        <div className="flex items-center gap-6">
          <Link href="/chat" className="hover:text-white transition-colors">
            Playground
          </Link>
          <Link href="/models" className="hover:text-white transition-colors">
            Models
          </Link>
          <Link href="/docs" className="hover:text-white transition-colors">
            Docs
          </Link>
        </div>
        <span className="font-mono">GET /health · GET /ready</span>
      </div>
      {children}
    </footer>
  );
}

// ─── Page header block (eyebrow + title with gradient word + lede) ───────────

export function AuroraPageHeader({
  eyebrow,
  title,
  gradientWord,
  lede,
}: {
  eyebrow: string;
  title: string;
  gradientWord?: string;
  lede?: React.ReactNode;
}) {
  const parts = gradientWord && title.includes(gradientWord)
    ? title.split(gradientWord)
    : null;
  return (
    <div className="flex flex-col gap-3 fxz-fade-up">
      <span className="fxz-section-eyebrow">{eyebrow}</span>
      <h1 className="fxz-page-title max-w-3xl">
        {parts ? (
          <>
            {parts[0]}
            <span className="fxz-gradient-word">{gradientWord}</span>
            {parts[1]}
          </>
        ) : (
          title
        )}
      </h1>
      {lede && (
        <p className="text-[15px] leading-relaxed text-muted-foreground max-w-2xl">
          {lede}
        </p>
      )}
    </div>
  );
}

// ─── Shell ───────────────────────────────────────────────────────────────────

export function AuroraShell({
  children,
  footer,
  className,
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("fxz-aurora-root min-h-screen flex flex-col text-[#e2e2ea]", className)}>
      <AuroraBackground />
      <AuroraNav />
      <main className="relative z-10 flex-1 mx-auto max-w-7xl w-full px-4 sm:px-6 pb-16 min-w-0">
        {children}
      </main>
      <AuroraFooter>{footer}</AuroraFooter>
    </div>
  );
}

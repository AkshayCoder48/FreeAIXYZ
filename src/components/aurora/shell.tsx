"use client";

/**
 * AuroraShell — the shared WARM AURORA app chrome for every content page
 * (playground, models, docs).
 *
 * Design language (identical to the landing hero):
 *   - near-black ground #07080a with living warm light-blades
 *     (crimson #ff2f3a → coral #ff6b4a → amber #ffb347) drifting + breathing
 *     on pure-CSS keyframes, layered under film-grain + vignette;
 *   - a floating dark-glass PILL NAV (backdrop-blur, hairline border,
 *     inner-top highlight) with the warm diamond glyph + wordmark;
 *   - tactile keycap accents, warm mono captions;
 *   - strictly WARM — no purple/indigo/violet anywhere.
 *
 * The background layer is position:fixed and dimmed (`.fxz-blades-dim`) so
 * long scrolling content (docs) stays readable while the aurora stays alive.
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

/** Warm diamond glyph — the brand mark (crimson → coral → amber). */
export function AuroraGlyph({ size = 14 }: { size?: number }) {
  return (
    <span
      className="inline-block shrink-0 rotate-45 rounded-[3px]"
      style={{
        width: size,
        height: size,
        background: "linear-gradient(135deg, #ff2f3a 0%, #ff6b4a 60%, #ffb347 100%)",
        boxShadow: "0 0 12px rgba(255,47,58,0.55)",
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
          className="flex items-center justify-between rounded-full border border-white/10 bg-black/60 backdrop-blur-xl px-4 sm:px-5 py-2.5"
          style={{
            boxShadow:
              "0 18px 50px -18px rgba(0,0,0,0.9), inset 0 1px 0 rgba(255,255,255,0.07)",
          }}
          aria-label="Main navigation"
        >
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 shrink-0">
            <AuroraGlyph />
            <span className="text-[15px] font-semibold tracking-tight text-white">
              FreeAI<span className="text-zinc-500">XYZ</span>
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
                    active ? "text-white" : "text-[#9c9c9d] hover:text-white",
                  )}
                >
                  <Icon
                    className={cn("h-3.5 w-3.5", active ? "text-[#ff6b4a]" : "text-[#7c7c7f]")}
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
              className="md:hidden inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 text-zinc-300 hover:text-white transition-colors"
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

        {/* Mobile dropdown (dark glass, warm active) */}
        {open && (
          <div
            className="md:hidden absolute left-0 right-0 top-[calc(100%+10px)] rounded-2xl border border-white/10 bg-black/85 backdrop-blur-xl p-2"
            style={{ boxShadow: "0 24px 60px -18px rgba(0,0,0,0.95), inset 0 1px 0 rgba(255,255,255,0.06)" }}
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
                      : "text-[#9c9c9d] hover:text-white hover:bg-white/[0.04]",
                  )}
                >
                  <Icon
                    className={cn("h-4 w-4", active ? "text-[#ff6b4a]" : "text-[#7c7c7f]")}
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

// ─── Fixed warm aurora background (dimmed for content pages) ─────────────────

export function AuroraBackground() {
  return (
    <div aria-hidden className="pointer-events-none">
      <div className="fxz-blades fxz-blades-dim">
        <div className="fxz-blade fxz-blade-1" />
        <div className="fxz-blade fxz-blade-2" />
        <div className="fxz-blade fxz-blade-3" />
        <div className="fxz-blade fxz-blade-4" />
        <div className="fxz-aurora-core" />
      </div>
      <div className="fxz-grain fxz-grain-fixed" />
      <div className="fxz-vignette fxz-grain-fixed" />
    </div>
  );
}

// ─── Footer (sticky to the bottom via mt-auto) ───────────────────────────────

export function AuroraFooter({ children }: { children?: React.ReactNode }) {
  return (
    <footer className="mt-auto relative z-10 border-t border-white/[0.06] bg-black/40">
      <div className="mx-auto max-w-6xl px-6 py-7 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#7c7c7f]">
        <div className="flex items-center gap-2.5">
          <AuroraGlyph size={10} />
          <span className="text-zinc-400">FreeAIXYZ — free AI gateway</span>
        </div>
        <div className="flex items-center gap-6">
          <Link href="/chat" className="hover:text-zinc-200 transition-colors">
            Playground
          </Link>
          <Link href="/models" className="hover:text-zinc-200 transition-colors">
            Models
          </Link>
          <Link href="/docs" className="hover:text-zinc-200 transition-colors">
            Docs
          </Link>
        </div>
        <span style={{ fontFamily: "var(--font-mono), ui-monospace, monospace" }}>
          GET /health · GET /ready
        </span>
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
  /** The ONE word rendered with the warm amber→crimson gradient. */
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
        <p className="text-[15px] leading-relaxed text-[#9c9c9d] max-w-2xl">{lede}</p>
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
    <div className={cn("fxz-aurora-root min-h-screen flex flex-col text-white", className)}>
      <AuroraBackground />
      <AuroraNav />
      <main className="relative z-10 flex-1 mx-auto max-w-7xl w-full px-4 sm:px-6 pb-16 min-w-0">
        {children}
      </main>
      <AuroraFooter>{footer}</AuroraFooter>
    </div>
  );
}

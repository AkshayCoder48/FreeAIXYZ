"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import {
  Menu,
  Sun,
  Cpu,
  BookOpen,
  Settings,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";

const emptySubscribe = () => () => {};
function useMounted() {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}

const NAV_LINKS = [
  { href: "/chat", label: "Playground", icon: MessageSquare },
  { href: "/models", label: "Models", icon: Cpu },
  { href: "/docs", label: "Docs", icon: BookOpen },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Nav() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const mounted = useMounted();

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
      <nav className="mx-auto max-w-7xl h-16 px-4 sm:px-6 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 shrink-0 group">
          <span
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[#0052FF] to-[#4D7CFF] text-white text-sm font-bold shadow-accent"
            aria-hidden
          >
            F
          </span>
          <span
            className="block text-lg font-bold tracking-tight text-foreground"
            style={{ fontFamily: "var(--font-display), Georgia, serif" }}
          >
            FreeAI<span className="text-muted-foreground">XYZ</span>
          </span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-1">
          {NAV_LINKS.map(({ href, label, icon: Icon }) => {
            const active =
              href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2 text-xs font-medium uppercase tracking-[0.12em] rounded-full transition-all duration-200",
                  active
                    ? "bg-accent/10 text-accent"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted",
                )}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                {label}
              </Link>
            );
          })}
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2">
          {mounted ? <ThemeToggle /> : (
            <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Toggle theme">
              <Sun className="h-4 w-4" />
            </Button>
          )}

          {/* Mobile hamburger */}
          {mounted ? (
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="h-10 w-10 md:hidden">
                  <Menu className="h-5 w-5" strokeWidth={1.5} />
                  <span className="sr-only">Menu</span>
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-72 p-6 bg-background border-l border-border">
                <SheetTitle className="sr-only">Navigation</SheetTitle>
                <div className="flex flex-col gap-1 mt-4">
                  {NAV_LINKS.map(({ href, label, icon: Icon }) => {
                    const active =
                      href === "/"
                        ? pathname === "/"
                        : pathname.startsWith(href);
                    return (
                      <Link
                        key={href}
                        href={href}
                        onClick={() => setMobileOpen(false)}
                        className={cn(
                          "flex items-center gap-3 px-4 py-3 text-sm font-medium uppercase tracking-[0.12em] rounded-lg transition-colors duration-150",
                          active
                            ? "bg-accent/10 text-accent"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted",
                        )}
                      >
                        <Icon className="h-4 w-4" strokeWidth={1.5} />
                        {label}
                      </Link>
                    );
                  })}
                </div>
              </SheetContent>
            </Sheet>
          ) : (
            <Button variant="ghost" size="icon" className="h-10 w-10 md:hidden" aria-label="Menu">
              <Menu className="h-5 w-5" strokeWidth={1.5} />
            </Button>
          )}
        </div>
      </nav>
    </header>
  );
}

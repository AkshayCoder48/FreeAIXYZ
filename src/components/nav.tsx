"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Sparkles,
  Menu,
  Cpu,
  ImageIcon,
  VideoIcon,
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

const NAV_LINKS = [
  { href: "/chat", label: "Playground", icon: MessageSquare },
  { href: "/models", label: "Models", icon: Cpu },
  { href: "/image", label: "Image Studio", icon: ImageIcon },
  { href: "/video", label: "Video Studio", icon: VideoIcon },
  { href: "/docs", label: "Docs", icon: BookOpen },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Nav() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-4 z-50 mx-auto max-w-6xl w-[calc(100%-2rem)] sm:w-[calc(100%-4rem)]">
      <nav className="h-16 sm:h-20 rounded-[32px] sm:rounded-[40px] bg-white/70 dark:bg-[#221A33]/70 backdrop-blur-xl shadow-clay-card border border-white/40 dark:border-[rgba(167,139,250,0.12)] px-4 sm:px-8 flex items-center justify-between transition-all duration-300">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 shrink-0 group">
          <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-purple-400 to-purple-600 flex items-center justify-center shadow-clay-button group-hover:shadow-clay-button-hover transition-all duration-300 group-hover:-translate-y-0.5 active:scale-[0.92] active:shadow-clay-pressed">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div className="leading-tight">
            <span
              className="block text-base font-extrabold tracking-tight text-foreground"
              style={{ fontFamily: "var(--font-brand), sans-serif" }}
            >
              Free<span className="text-primary">AI</span>4All
            </span>
            <span
              className="block text-[10px] text-muted-foreground font-medium tracking-wide uppercase"
              style={{ fontFamily: "var(--font-code), monospace" }}
            >
              inference platform
            </span>
          </div>
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
                  "flex items-center gap-1.5 px-4 py-2 rounded-[20px] text-sm font-medium transition-all duration-200",
                  active
                    ? "bg-gradient-to-br from-purple-400/15 to-purple-600/10 text-primary shadow-clay-pressed"
                    : "text-muted-foreground hover:text-foreground hover:-translate-y-0.5 hover:bg-purple-500/5"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </Link>
            );
          })}
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2">
          <ThemeToggle />

          {/* Mobile hamburger */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="h-10 w-10 rounded-[20px] md:hidden hover:-translate-y-0.5 active:scale-[0.92] active:shadow-clay-pressed transition-all duration-200">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72 p-6 rounded-l-[32px] bg-white/90 dark:bg-[#1A1625]/90 backdrop-blur-xl">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <div className="flex flex-col gap-2 mt-4">
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
                        "flex items-center gap-3 px-4 py-3 rounded-[20px] transition-all duration-200 text-sm font-medium",
                        active
                          ? "bg-gradient-to-br from-purple-400/15 to-purple-600/10 text-primary shadow-clay-pressed"
                          : "text-muted-foreground hover:text-foreground hover:-translate-y-0.5 hover:bg-purple-500/5"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                    </Link>
                  );
                })}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </nav>
    </header>
  );
}

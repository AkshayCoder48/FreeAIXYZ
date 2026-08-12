"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
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
    <header className="sticky top-0 z-50 w-full border-b border-foreground bg-background">
      <nav className="mx-auto max-w-6xl h-16 px-6 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-3 shrink-0 group">
          <span
            className="block text-lg font-bold tracking-tight text-foreground"
            style={{ fontFamily: "var(--font-brand), serif" }}
          >
            FreeAI<span className="text-muted-foreground">4All</span>
          </span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-0">
          {NAV_LINKS.map(({ href, label, icon: Icon }) => {
            const active =
              href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-1.5 px-4 py-2 text-xs font-medium uppercase tracking-widest transition-colors duration-100 border-b-2",
                  active
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-foreground/30"
                )}
              >
                <Icon className="h-3 w-3" strokeWidth={1.5} />
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
              <Button variant="ghost" size="icon" className="h-10 w-10 md:hidden">
                <Menu className="h-5 w-5" strokeWidth={1.5} />
                <span className="sr-only">Menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72 p-6 bg-background border-l border-foreground">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <div className="flex flex-col gap-0 mt-4">
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
                        "flex items-center gap-3 px-4 py-3 text-sm font-medium uppercase tracking-widest border-b border-foreground/10 transition-colors duration-100",
                        active
                          ? "bg-foreground text-background"
                          : "text-muted-foreground hover:text-foreground hover:bg-foreground/5"
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
        </div>
      </nav>
    </header>
  );
}

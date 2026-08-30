import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * SiteFooter — sticky-to-bottom footer.
 *
 * Designed to live at the bottom of a `min-h-screen flex flex-col` root
 * wrapper. The footer itself has `mt-auto` so it sticks to the bottom on
 * short pages and gets pushed down naturally on long pages.
 */
interface SiteFooterProps extends React.HTMLAttributes<HTMLElement> {
  children?: React.ReactNode;
}

export function SiteFooter({ children, className, ...props }: SiteFooterProps) {
  return (
    <footer
      className={cn(
        "mt-auto border-t border-border bg-background/80 backdrop-blur",
        className,
      )}
      {...props}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
        {children ?? (
          <>
            <span>
              FreeAIXYZ — dynamic discovery · true SSE · provider health
            </span>
            <span
              className="font-mono"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >
              GET /health · GET /ready · GET /api/metrics
            </span>
          </>
        )}
      </div>
    </footer>
  );
}

/**
 * SiteFooterLink — small footer link with hover underline.
 */
export function SiteFooterLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "text-muted-foreground hover:text-foreground transition-colors",
        className,
      )}
    >
      {children}
    </Link>
  );
}

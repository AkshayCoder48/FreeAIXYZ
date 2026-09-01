"use client";

/**
 * CopyIdButton — small client-only copy-to-clipboard button (PRD §33).
 *
 * The single-model page is an RSC that resolves the model server-side, but
 * `navigator.clipboard.writeText` only runs in the browser. This little
 * island handles the click → copy → 1.5s checkmark feedback cycle.
 */
import * as React from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export function CopyIdButton({
  value,
  label = "Copy model id",
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = React.useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      } catch {
        /* clipboard unavailable */
      }
    },
    [value],
  );

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        "inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-white/10 bg-white/[0.03] hover:border-[#ff6b4a]/40 text-xs text-[#9c9c9d] hover:text-white transition-colors shrink-0",
        className,
      )}
      aria-label={label}
      title={label}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-[#ffb347]" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      <span className="font-mono" style={{ fontFamily: "var(--font-mono), monospace" }}>
        {copied ? "Copied" : "Copy"}
      </span>
    </button>
  );
}

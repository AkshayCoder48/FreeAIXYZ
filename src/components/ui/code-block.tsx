"use client";

/**
 * Beautiful code block component — creative design with gradient header,
 * soft slate background, traffic-light dots, filename pill.
 */

import { useState } from "react";
import { Check, Copy, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";

export function BeautifulCodeBlock({
  code,
  filename = "snippet",
  showHeader = true,
  className,
}: {
  code: string;
  filename?: string;
  showHeader?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div
      className={cn(
        "relative rounded-2xl overflow-hidden border border-[#ff9a3c]/20 shadow-lg shadow-[#ff9a3c]/5 bg-gradient-to-br from-slate-50 to-slate-100",
        className,
      )}
    >
      {showHeader && (
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#ff9a3c]/15 bg-gradient-to-r from-[#ff9a3c]/8 via-[#ff9a3c]/4 to-transparent">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-400/80 ring-1 ring-rose-300/40" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400/80 ring-1 ring-amber-300/40" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff9a3c]/80 ring-1 ring-[#ff9a3c]/40" />
          </div>
          <span className="ml-1 text-[11px] font-mono text-muted-foreground bg-background/60 backdrop-blur px-2 py-0.5 rounded-md border border-border/50">
            {filename}
          </span>
          <button
            onClick={copy}
            className="ml-auto inline-flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-[#ff9a3c] transition-colors px-2 py-1 rounded-md hover:bg-[#ff9a3c]/5"
          >
            {copied ? (
              <>
                <Check className="h-3 w-3 text-emerald-500" /> Copied
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" /> Copy
              </>
            )}
          </button>
        </div>
      )}
      <pre className="overflow-x-auto p-5 text-[12.5px] leading-[1.7] font-mono max-h-[520px] overflow-y-auto">
        <code className="text-slate-800">{code}</code>
      </pre>
      {!showHeader && (
        <button
          onClick={copy}
          className="absolute top-3 right-3 inline-flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-[#ff9a3c] transition-colors px-2 py-1 rounded-md bg-background/60 backdrop-blur border border-border/50 hover:bg-[#ff9a3c]/5"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-500" /> Copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" /> Copy
            </>
          )}
        </button>
      )}
    </div>
  );
}

/** Compact variant for inline quickstart blocks. */
export function QuickCodeBlock({
  code,
  title,
}: {
  code: string;
  title?: string;
}) {
  return (
    <div className="rounded-2xl overflow-hidden border border-[#ff9a3c]/20 shadow-lg shadow-[#ff9a3c]/5 bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#ff9a3c]/15 bg-gradient-to-r from-[#ff9a3c]/8 via-[#ff9a3c]/4 to-transparent">
        <Terminal className="h-3.5 w-3.5 text-[#ff9a3c]" />
        <span className="text-[11px] text-muted-foreground font-mono">
          {title ?? "quickstart"}
        </span>
      </div>
      <pre className="overflow-x-auto p-5 text-[12.5px] leading-[1.7] font-mono">
        <code className="text-slate-800">{code}</code>
      </pre>
    </div>
  );
}

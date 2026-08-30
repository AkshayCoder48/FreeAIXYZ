"use client";

/**
 * RawSseDebugger — optional dev-mode panel showing raw SSE lines (PRD §108).
 *
 * The server already redacts sensitive fields (PRD §209); this component just
 * displays the `data:` payloads as they arrive from the hook's onRawData
 * callback. Off by default — toggle to enable.
 *
 * Styled per Minimalist Modern: rounded-xl card with subtle border, accent
 * toggles.
 */

import * as React from "react";
import { Terminal, Trash2, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface RawSseDebuggerProps {
  /** Lines pushed by the parent (chat-playground forwards hook.onRawData). */
  lines: string[];
  enabled: boolean;
  onToggle: (v: boolean) => void;
  onClear: () => void;
}

export function RawSseDebugger({
  lines,
  enabled,
  onToggle,
  onClear,
}: RawSseDebuggerProps) {
  return (
    <section
      className="rounded-xl border border-border bg-card overflow-hidden shadow-sm"
      aria-label="Raw SSE debugger"
    >
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Terminal className="h-3.5 w-3.5" strokeWidth={1.75} />
          </span>
          <span
            className="text-xs font-medium uppercase tracking-[0.15em]"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            Raw SSE
          </span>
          {enabled && (
            <span
              className="text-[9px] uppercase tracking-[0.1em] px-1.5 py-0.5 rounded-full border border-accent/30 bg-accent/5 text-accent"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >
              {lines.length} line{lines.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label
            className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground cursor-pointer"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            {enabled ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
            <Switch checked={enabled} onCheckedChange={onToggle} />
          </label>
          {enabled && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClear}
              className="h-7 gap-1.5 text-[10px] uppercase tracking-[0.12em] rounded-full hover:bg-accent/10 hover:text-accent"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >
              <Trash2 className="h-3 w-3" strokeWidth={1.75} />
              Clear
            </Button>
          )}
        </div>
      </header>
      {enabled && (
        <ScrollArea className="max-h-64 custom-scroll">
          <pre
            className="p-3 text-[11px] leading-relaxed text-foreground/90 bg-[#0F172A] text-zinc-100"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            {lines.length === 0 ? (
              <span className="text-zinc-400 italic">
                Waiting for stream…
              </span>
            ) : (
              lines.map((line, i) => (
                <div key={i} className="whitespace-pre-wrap break-all">
                  <span className="text-zinc-500 select-none">
                    {(i + 1).toString().padStart(3, "0")}:{' '}
                  </span>
                  <span className={cn("text-zinc-100")}>{line || "<empty>"}</span>
                </div>
              ))
            )}
          </pre>
        </ScrollArea>
      )}
    </section>
  );
}

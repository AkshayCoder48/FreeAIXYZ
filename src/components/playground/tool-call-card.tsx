"use client";

/**
 * ToolCallCard — compact card rendering one streamed tool call (PRD §17, §24).
 *
 * Rendered by `MessageBubble` for each tool-call index on an assistant message
 * (one card per index — NEVER a new card per delta, PRD §17). The card
 * receives the RAW accumulated arguments buffer; it pretty-prints the JSON
 * only if the buffer parses as a complete JSON object — otherwise it shows
 * the raw fragment stream (PRD §12 — never JSON.parse partial buffers).
 *
 * Status semantics:
 *  - streaming  : argument fragments still arriving (amber spinner)
 *  - ready      : stream ended; arguments buffer is complete (emerald check)
 *  - executing  : the tool is being invoked (reserved for future use)
 *  - result     : the tool returned a result (emerald terminal icon)
 *
 * Styling: Tailwind built-in vars only (no indigo/blue). Matches the existing
 * playground aesthetic (rounded-xl, border-border, mono font for code).
 */

import * as React from "react";
import { Wrench, Check, Loader2, PlayCircle, Terminal } from "lucide-react";
import {
  Card,
  CardHeader,
  CardContent,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type ToolCallStatus =
  | "streaming"
  | "ready"
  | "executing"
  | "result";

export interface ToolCallCardProps {
  /** Tool/function name (may be empty until the first name-bearing delta). */
  name: string;
  /** Raw accumulated arguments buffer — may be partial during streaming. */
  argumentsRaw: string;
  status: ToolCallStatus;
  /** Optional tool result string (rendered in a separate result block). */
  result?: string;
}

interface StatusVisual {
  label: string;
  badgeClassName: string;
  icon: React.ReactNode;
}

function statusVisual(status: ToolCallStatus): StatusVisual {
  switch (status) {
    case "streaming":
      return {
        label: "streaming",
        badgeClassName:
          "border-amber-300 bg-amber-50 text-amber-700 " +
          "dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800",
        icon: (
          <Loader2
            className="h-3 w-3 animate-spin text-amber-500"
            strokeWidth={1.75}
            aria-hidden="true"
          />
        ),
      };
    case "ready":
      return {
        label: "ready",
        badgeClassName:
          "border-emerald-300 bg-emerald-50 text-emerald-700 " +
          "dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800",
        icon: (
          <Check
            className="h-3 w-3 text-emerald-500"
            strokeWidth={1.75}
            aria-hidden="true"
          />
        ),
      };
    case "executing":
      return {
        label: "executing",
        badgeClassName: "border-border bg-muted text-foreground",
        icon: (
          <PlayCircle
            className="h-3 w-3 text-muted-foreground"
            strokeWidth={1.75}
            aria-hidden="true"
          />
        ),
      };
    case "result":
      return {
        label: "result",
        badgeClassName:
          "border-emerald-300 bg-emerald-50 text-emerald-700 " +
          "dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800",
        icon: (
          <Terminal
            className="h-3 w-3 text-emerald-500"
            strokeWidth={1.75}
            aria-hidden="true"
          />
        ),
      };
  }
}

/**
 * Pretty-print the arguments buffer if (and only if) it parses as a complete
 * JSON object/array. Partial buffers MUST remain raw (PRD §12). Returns the
 * raw buffer verbatim if parsing fails or yields a non-object primitive.
 */
function tryPrettyPrint(raw: string): string {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object") {
      return JSON.stringify(parsed, null, 2);
    }
    // Primitives (string/number/bool) — return as-is, raw is already compact.
    return raw;
  } catch {
    // Partial JSON mid-stream — return raw buffer (PRD §12).
    return raw;
  }
}

export function ToolCallCard({
  name,
  argumentsRaw,
  status,
  result,
}: ToolCallCardProps) {
  const visual = statusVisual(status);
  const pretty = tryPrettyPrint(argumentsRaw);
  const displayName = name || "—";

  return (
    <Card
      className="rounded-xl border-border bg-card py-0 gap-0 shadow-sm overflow-hidden w-full max-w-full"
      role="group"
      aria-label={`Tool call: ${displayName}`}
    >
      <CardHeader className="px-3 pt-2.5 pb-2 flex flex-row items-center justify-between gap-2 min-w-0">
        <CardTitle className="text-xs font-medium leading-none flex items-center gap-2 min-w-0">
          <span
            className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-muted text-muted-foreground shrink-0"
            aria-hidden="true"
          >
            <Wrench className="h-3 w-3" strokeWidth={1.75} />
          </span>
          <span
            className="text-foreground truncate min-w-0"
            style={{ fontFamily: "var(--font-mono), monospace" }}
            title={displayName}
          >
            {displayName}
          </span>
        </CardTitle>
        <Badge
          variant="outline"
          className={cn(
            "text-[9px] uppercase tracking-[0.12em] gap-1 px-1.5 py-0.5 rounded-full shrink-0",
            visual.badgeClassName,
          )}
        >
          {visual.icon}
          {visual.label}
        </Badge>
      </CardHeader>
      <CardContent className="px-3 pb-2.5 pt-0">
        <pre
          className="text-[11px] leading-relaxed text-foreground/90 bg-muted/40 rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-all border border-border max-h-64"
          style={{ fontFamily: "var(--font-mono), monospace" }}
          aria-label="Tool call arguments"
        >
          {pretty || "(empty)"}
        </pre>
        {result ? (
          <pre
            className="mt-2 text-[11px] leading-relaxed text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-all border border-emerald-200 dark:border-emerald-900 max-h-64"
            style={{ fontFamily: "var(--font-mono), monospace" }}
            aria-label="Tool call result"
          >
            {result}
          </pre>
        ) : null}
      </CardContent>
    </Card>
  );
}

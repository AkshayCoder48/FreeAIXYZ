"use client";

/**
 * StreamingDiagnostics — live TTFT / chunks / duration / bytes panel (PRD §56, §107).
 *
 * Receives timing data either from a parent component (controlled mode) or
 * runs a "Test slow SSE" probe to /api/debug/stream and displays the results.
 * Renders an inline horizontal bar with metrics updating as the stream
 * progresses, plus a "Test slow SSE" button that hits /api/debug/stream
 * and shows whether chunks arrive incrementally (PRD §15 buffering detector).
 *
 * Styled per Minimalist Modern design: wrapped in a FeaturedCard (gradient
 * border).
 */

import * as React from "react";
import {
  Gauge,
  Zap,
  Activity,
  Server,
  Loader2,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FeaturedCard } from "@/components/site/featured-card";
import { cn } from "@/lib/utils";
import {
  useSseStream,
  type SseStreamState,
  type SseTimings,
  type SseTimingsDerived,
} from "@/hooks/use-sse-stream";

interface StreamingDiagnosticsProps {
  /** Controlled mode: parent (chat-playground) provides live timings. */
  state?: SseStreamState;
  timings?: SseTimings;
  derived?: SseTimingsDerived;
}

function formatMs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms <= 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

interface ProbeEvent {
  index: number;
  at: number;
}

export function StreamingDiagnostics(
  props: StreamingDiagnosticsProps,
) {
  const isControlled = props.state !== undefined;
  const state = props.state ?? "idle";
  const timings = props.timings ?? {
    requestStart: null,
    firstChunkAt: null,
    streamEndAt: null,
    chunkCount: 0,
    bytes: 0,
  };
  const derived = props.derived ?? { ttftMs: null, durationMs: null };

  // Probe mode (uncontrolled) — "Test slow SSE" using the useSseStream hook.
  const probe = useSseStream();
  const [probeEvents, setProbeEvents] = React.useState<ProbeEvent[]>([]);
  const [probeStart, setProbeStart] = React.useState<number | null>(null);

  const handleProbe = React.useCallback(() => {
    setProbeEvents([]);
    setProbeStart(Date.now());
    void probe.start({
      url: "/api/debug/stream",
      method: "GET",
      headers: { Accept: "text/event-stream" },
      onDelta: () => {
        // The debug stream emits `{ event: N }` data, no content deltas — ignore.
      },
      onRawData: () => {
        setProbeEvents((prev) => [
          ...prev,
          { index: prev.length + 1, at: Date.now() },
        ]);
      },
    });
  }, [probe]);

  const probeState = probe.state;
  const probeTimings = probe.timings;
  const probeDerived = probe.derived;

  const probeIncremental =
    probeEvents.length >= 2
      ? probeEvents[probeEvents.length - 1].at - probeEvents[0].at >=
        (probeEvents.length - 1) * 600
      : false;
  const probeBuffered =
    probeEvents.length >= 2
      ? probeEvents[probeEvents.length - 1].at - probeEvents[0].at <
        (probeEvents.length - 1) * 300
      : false;

  return (
    <FeaturedCard innerClassName="p-4 space-y-4">
      <header className="flex items-center justify-between">
        <h3
          className="text-sm font-semibold uppercase tracking-[0.12em] flex items-center gap-2 text-foreground"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <Gauge className="h-3.5 w-3.5" strokeWidth={1.75} />
          </span>
          Diagnostics
        </h3>
        <span
          className={cn(
            "text-[10px] uppercase tracking-[0.12em] px-2.5 py-0.5 rounded-full border border-border inline-flex items-center gap-1.5",
          )}
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          <span
            className={cn(
              "inline-block h-1.5 w-1.5 rounded-full",
              state === "streaming"
                ? "bg-emerald-500"
                : state === "done"
                  ? "bg-emerald-500"
                  : state === "error"
                    ? "bg-rose-500"
                    : state === "aborted"
                      ? "bg-amber-500"
                      : "bg-muted-foreground/40",
            )}
          />
          {state}
        </span>
      </header>

      <div className="grid grid-cols-2 gap-2">
        <Metric
          label="TTFT"
          value={formatMs(derived.ttftMs)}
          icon={Zap}
          hint="request → first token"
        />
        <Metric
          label="Duration"
          value={formatMs(derived.durationMs)}
          icon={Activity}
          hint="request → done"
        />
        <Metric
          label="Chunks"
          value={String(timings.chunkCount)}
          icon={Server}
          hint="SSE events"
        />
        <Metric
          label="Bytes"
          value={formatBytes(timings.bytes)}
          icon={Gauge}
          hint="total received"
        />
      </div>

      <div>
        <div
          className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground mb-1.5"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          Inline stream
        </div>
        <div className="h-2 bg-muted overflow-hidden rounded-full border border-border">
          <div
            className={cn(
              "h-full transition-all rounded-full",
              state === "streaming"
                ? "bg-gradient-to-r from-[#0052FF] to-[#4D7CFF]"
                : state === "done"
                  ? "bg-emerald-500"
                  : state === "error"
                    ? "bg-rose-500"
                    : state === "aborted"
                      ? "bg-amber-500"
                      : "bg-muted-foreground/40",
            )}
            style={{
              width:
                state === "streaming"
                  ? "60%"
                  : state === "done" || state === "error" || state === "aborted"
                    ? "100%"
                    : "0%",
            }}
          />
        </div>
      </div>

      {!isControlled && (
        <div className="border-t border-border pt-3 space-y-3">
          <div className="flex items-center justify-between">
            <span
              className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >
              Buffering probe
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleProbe}
              disabled={probeState === "streaming" || probeState === "connecting"}
              className="h-8 gap-1.5 text-[10px] uppercase tracking-[0.12em] border-accent text-accent hover:bg-accent hover:text-white rounded-full"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >
              {probeState === "streaming" || probeState === "connecting" ? (
                <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.75} />
              ) : (
                <Zap className="h-3 w-3" strokeWidth={1.75} />
              )}
              Test slow SSE
            </Button>
          </div>

          {probeEvents.length > 0 && (
            <ScrollArea className="max-h-32 pr-2 custom-scroll">
              <ul className="space-y-1">
                {probeEvents.map((e, i) => {
                  const delta =
                    probeStart !== null
                      ? `${((e.at - probeStart) / 1000).toFixed(2)}s`
                      : "—";
                  return (
                    <li
                      key={i}
                      className="text-[10px] text-muted-foreground"
                      style={{ fontFamily: "var(--font-mono), monospace" }}
                    >
                      event {e.index} at +{delta}
                    </li>
                  );
                })}
              </ul>
            </ScrollArea>
          )}

          {probeState === "done" && probeEvents.length >= 2 && (
            <Alert className="rounded-lg">
              {probeBuffered ? (
                <AlertTriangle className="h-4 w-4 text-amber-500" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              )}
              <AlertDescription className="text-xs">
                {probeBuffered
                  ? `Buffering detected: ${probeEvents.length} events arrived within ${(probeEvents[probeEvents.length - 1].at - probeEvents[0].at) / 1000}s of each other. Infrastructure is buffering the stream — check X-Accel-Buffering: no / flush interval.`
                  : probeIncremental
                    ? `Stream is incremental: ${probeEvents.length} events spread over ${(probeEvents[probeEvents.length - 1].at - probeEvents[0].at) / 1000}s — no buffering detected at any layer.`
                    : `Probe complete: TTFT ${formatMs(probeDerived.ttftMs)} · duration ${formatMs(probeDerived.durationMs)} · chunks ${probeTimings.chunkCount}.`}
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}
    </FeaturedCard>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
  hint,
}: {
  label: string;
  value: string;
  icon: typeof Zap;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div
        className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground flex items-center gap-1.5"
        style={{ fontFamily: "var(--font-mono), monospace" }}
      >
        <Icon className="h-3 w-3 text-accent" strokeWidth={1.75} />
        {label}
      </div>
      <div
        className="text-lg font-bold mt-1 text-foreground"
        style={{ fontFamily: "var(--font-mono), monospace" }}
      >
        {value}
      </div>
      {hint && (
        <div
          className="text-[9px] text-muted-foreground mt-0.5"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

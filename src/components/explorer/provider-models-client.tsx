"use client";

/**
 * ProviderModelsClient — the per-provider grid of model cards.
 *
 * Receives the already-resolved static model list from the server (the
 * parent RSC passes a JSON-serializable subset down). Renders a responsive
 * grid of cards with the same visual language as the main /models catalog.
 *
 * The only client state on this page is the copy-id feedback (handled by
 * the `<CopyIdButton />` island) and "Show more" pagination.
 */
import * as React from "react";
import Link from "next/link";
import { ArrowRight, Zap, Brain } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { CopyIdButton } from "@/components/explorer/copy-id-button";

export interface ProviderModelEntry {
  id: string;
  name: string;
  providerId: string;
  providerName: string;
  description: string;
  capabilities: {
    streaming: boolean;
    reasoning: boolean;
    vision: boolean;
    tools: boolean;
    webSearch: boolean;
  };
  contextWindow: number;
}

interface Props {
  providerLabel: string;
  models: ProviderModelEntry[];
}

const INITIAL_VISIBLE = 24;
const LOAD_INCREMENT = 24;

export function ProviderModelsClient({
  providerLabel,
  models,
}: Props) {
  const [visible, setVisible] = React.useState(INITIAL_VISIBLE);

  // Reset pagination when the model set changes.
  React.useEffect(() => {
    setVisible(INITIAL_VISIBLE);
  }, [models]);

  const visibleModels = models.slice(0, visible);
  const remaining = models.length - visibleModels.length;

  return (
    <div className="flex flex-col gap-6 min-w-0">
      {/* Header */}
      <header className="flex flex-col gap-3 min-w-0">
        <div className="flex items-baseline justify-between gap-3 flex-wrap min-w-0">
          <h1
            className="text-3xl sm:text-4xl font-normal tracking-tight text-foreground min-w-0"
            style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
          >
            {providerLabel}
          </h1>
          <span
            className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            {models.length} model{models.length === 1 ? "" : "s"} · native
          </span>
        </div>
      </header>

      {/* Empty state */}
      {models.length === 0 ? (
        <div className="text-center py-16 text-sm text-muted-foreground flex flex-col items-center gap-3">
          <span>No models under this provider.</span>
          <Link
            href="/models"
            className="text-xs uppercase tracking-[0.15em] text-foreground hover:underline inline-flex items-center gap-1.5"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            <ArrowRight className="h-3 w-3 rotate-180" />
            Back to all models
          </Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 min-w-0">
            {visibleModels.map((m) => (
              <ProviderPageCard key={m.id} model={m} />
            ))}
          </div>

          {remaining > 0 && (
            <div className="flex justify-center pt-2 min-w-0">
              <button
                type="button"
                onClick={() =>
                  setVisible((c) => c + LOAD_INCREMENT)
                }
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs uppercase tracking-[0.1em] border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                style={{ fontFamily: "var(--font-mono), monospace" }}
              >
                Show {Math.min(LOAD_INCREMENT, remaining)} more · {remaining}{" "}
                hidden
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Card ────────────────────────────────────────────────────────────────────

function ProviderPageCard({ model }: { model: ProviderModelEntry }) {
  const href = `/models/${encodeURIComponent(
    model.providerId,
  )}/${encodeURIComponent(model.id)}`;

  return (
    <Card
      className="min-w-0 flex flex-col gap-3 p-4 sm:p-5 rounded-xl border bg-card text-card-foreground shadow-sm transition-colors border-border hover:border-foreground/20"
    >
      {/* Row 1: name + streaming badge */}
      <div className="flex items-start justify-between gap-3 min-w-0">
        <Link
          href={href}
          className="text-sm font-semibold text-foreground hover:text-accent transition-colors leading-snug min-w-0"
          style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
        >
          {model.name}
        </Link>
        {model.capabilities.streaming ? (
          <Badge
            variant="secondary"
            className="gap-1 shrink-0 text-[10px]"
          >
            <Zap className="h-2.5 w-2.5" /> stream
          </Badge>
        ) : (
          <Badge variant="outline" className="shrink-0 text-[10px]">
            batch
          </Badge>
        )}
      </div>

      {/* Description */}
      {model.description && (
        <p
          className="text-xs text-muted-foreground leading-relaxed line-clamp-2 min-w-0"
          title={model.description}
        >
          {model.description}
        </p>
      )}

      {/* Capability badges */}
      <div className="flex flex-wrap gap-1.5 min-w-0">
        {model.capabilities.reasoning && (
          <Badge variant="outline" className="gap-1 text-[10px]">
            <Brain className="h-2.5 w-2.5" /> reasoning
          </Badge>
        )}
        {model.capabilities.vision && (
          <Badge variant="outline" className="text-[10px]">vision</Badge>
        )}
        {model.capabilities.tools && (
          <Badge variant="outline" className="text-[10px]">tools</Badge>
        )}
        {model.capabilities.webSearch && (
          <Badge variant="outline" className="text-[10px]">web search</Badge>
        )}
        {model.contextWindow > 0 && (
          <Badge variant="outline" className="text-[10px] font-mono">
            {model.contextWindow >= 1000
              ? `${Math.round(model.contextWindow / 1000)}k ctx`
              : `${model.contextWindow} ctx`}
          </Badge>
        )}
      </div>

      {/* Model id + copy + try */}
      <div className="mt-auto flex items-center gap-2 min-w-0 pt-1">
        <code
          className="flex-1 min-w-0 text-[10px] font-mono text-muted-foreground bg-muted rounded px-2 py-1 truncate"
          title={model.id}
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          {model.id}
        </code>
        <CopyIdButton value={model.id} />
        <Link
          href={`/chat?model=${encodeURIComponent(model.id)}`}
          className="shrink-0 inline-flex items-center gap-1 text-[11px] font-medium px-2.5 h-7 rounded-md bg-accent text-accent-foreground hover:opacity-90 transition-opacity"
        >
          Try
        </Link>
      </div>
    </Card>
  );
}

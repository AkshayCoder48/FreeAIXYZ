"use client";

/**
 * ProviderModelsClient — the per-provider grid of model cards
 * (WARM AURORA design — dark glass cards, warm badges, keycap Try link).
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
import { ArrowRight, Zap, Brain, Wrench, Eye, Globe } from "lucide-react";

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
        <span className="fxz-section-eyebrow">Provider</span>
        <div className="flex items-baseline justify-between gap-3 flex-wrap min-w-0">
          <h1
            className="fxz-page-title min-w-0"
            style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
          >
            {providerLabel}
          </h1>
          <span
            className="text-[11px] uppercase tracking-[0.15em] text-[#9c9c9d]"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            {models.length} model{models.length === 1 ? "" : "s"} · native
          </span>
        </div>
      </header>

      {/* Empty state */}
      {models.length === 0 ? (
        <div className="text-center py-16 text-sm text-[#9c9c9d] flex flex-col items-center gap-3">
          <span>No models under this provider.</span>
          <Link
            href="/models"
            className="text-xs uppercase tracking-[0.15em] text-white hover:text-[#ff8a6b] inline-flex items-center gap-1.5 transition-colors"
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
                className="fxz-chip"
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
    <div
      className="fxz-panel fxz-panel-hover min-w-0 flex flex-col gap-3 p-4 sm:p-5 rounded-xl"
    >
      {/* Row 1: name + streaming badge */}
      <div className="flex items-start justify-between gap-3 min-w-0">
        <Link
          href={href}
          className="text-sm font-semibold text-white hover:text-[#ff8a6b] transition-colors leading-snug min-w-0"
          style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
        >
          {model.name}
        </Link>
        {model.capabilities.streaming ? (
          <span className="fxz-badge fxz-badge-warm gap-1 shrink-0">
            <Zap className="h-2.5 w-2.5" /> stream
          </span>
        ) : (
          <span className="fxz-badge shrink-0">batch</span>
        )}
      </div>

      {/* Description */}
      {model.description && (
        <p
          className="text-xs text-[#9c9c9d] leading-relaxed line-clamp-2 min-w-0"
          title={model.description}
        >
          {model.description}
        </p>
      )}

      {/* Capability badges */}
      <div className="flex flex-wrap gap-1.5 min-w-0">
        {model.capabilities.reasoning && (
          <span className="fxz-badge gap-1">
            <Brain className="h-2.5 w-2.5 text-[#ff6b4a]" /> reasoning
          </span>
        )}
        {model.capabilities.vision && (
          <span className="fxz-badge gap-1">
            <Eye className="h-2.5 w-2.5" /> vision
          </span>
        )}
        {model.capabilities.tools && (
          <span className="fxz-badge gap-1">
            <Wrench className="h-2.5 w-2.5 text-[#ff6b4a]" /> tools
          </span>
        )}
        {model.capabilities.webSearch && (
          <span className="fxz-badge gap-1">
            <Globe className="h-2.5 w-2.5" /> web search
          </span>
        )}
        {model.contextWindow > 0 && (
          <span className="fxz-badge font-mono">
            {model.contextWindow >= 1000
              ? `${Math.round(model.contextWindow / 1000)}k ctx`
              : `${model.contextWindow} ctx`}
          </span>
        )}
      </div>

      {/* Model id + copy + try */}
      <div className="mt-auto flex items-center gap-2 min-w-0 pt-1">
        <code
          className="fxz-code flex-1 min-w-0 truncate"
          title={model.id}
        >
          {model.id}
        </code>
        <CopyIdButton value={model.id} />
        <Link
          href={`/chat?model=${encodeURIComponent(model.id)}`}
          className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 h-7 rounded-md text-[#2f3031] transition-transform hover:-translate-y-px"
          style={{
            background: "#e6e6e6",
            boxShadow:
              "0 0 0 1.5px rgba(0,0,0,0.85), 0 0 10px rgba(255,255,255,0.12), inset 0 1px 0 rgba(255,255,255,0.95), inset 0 -1px 0 rgba(0,0,0,0.25)",
          }}
        >
          Try
        </Link>
      </div>
    </div>
  );
}

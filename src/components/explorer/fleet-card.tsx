"use client";

/**
 * FleetCard — one public Onyx fleet model card (FreeAIXYZ design).
 *
 * Used by the /models catalog (client) and the /models/[group] page (client
 * islands rendered from an RSC). Obsidian panel, alternating crimson/ember
 * rims, mono capability chips, the onyx id as a crimson code pill, and — for
 * hard-test-verified 18+ slots — a prominent crimson-glow UNCENSORED/18+
 * badge (.fxz-badge-nsfw) that reads at a glance.
 *
 * Card CTA is "Try in chat" → /chat?model=<onyx id>; the model name links to
 * the fleet detail page /models/<group>/<onyx id>.
 */

import * as React from "react";
import Link from "next/link";
import { MessageSquare, Zap, Brain, Wrench, Eye, Globe } from "lucide-react";

import { CopyIdButton } from "@/components/explorer/copy-id-button";
import { formatCtx, type CatalogFleetModel } from "@/components/explorer/fleet-meta";

export const FleetCard = React.memo(function FleetCard({
  m,
  emberRim = false,
}: {
  m: CatalogFleetModel;
  emberRim?: boolean;
}) {
  return (
    <div
      className={
        "fxz-panel p-4 flex flex-col gap-2.5 min-w-0 rounded-xl transition-all " +
        (emberRim
          ? "border-ember/25 hover:border-ember/70 hover:shadow-[0_16px_36px_rgba(255,133,13,0.22),inset_0_1px_1px_rgba(255,255,255,0.09)]"
          : "border-crimson/25 hover:border-crimson/70 hover:shadow-[0_16px_36px_rgba(255,42,85,0.25),inset_0_1px_1px_rgba(255,255,255,0.09)]")
      }
    >
      {/* Row 1: display name + (18+ badge | streaming chip) */}
      <div className="flex items-start justify-between gap-2 min-w-0">
        <Link
          href={`/models/${m.group}/${encodeURIComponent(m.id)}`}
          className="text-sm font-semibold text-white hover:text-crimson transition-colors leading-snug min-w-0"
          style={{ overflowWrap: "anywhere" }}
        >
          {m.name}
        </Link>
        {m.uncensored ? (
          <span className="fxz-badge-nsfw shrink-0" title="Hard-test verified uncensored · adults only">
            18+ uncensored
          </span>
        ) : (
          m.capabilities.streaming && (
            <span className="fxz-badge fxz-badge-ember gap-1 shrink-0">
              <Zap className="h-2.5 w-2.5" /> stream
            </span>
          )
        )}
      </div>

      {/* Brief */}
      <p
        className="text-xs text-muted-foreground leading-relaxed line-clamp-2 min-w-0"
        title={m.description}
      >
        {m.brief}
      </p>

      {/* Capability chips */}
      <div className="flex flex-wrap gap-1.5 min-w-0">
        {m.capabilities.reasoning && (
          <span className="fxz-badge fxz-badge-warm gap-1">
            <Brain className="h-2.5 w-2.5" /> reasoning
          </span>
        )}
        {m.capabilities.vision && (
          <span className="fxz-badge gap-1">
            <Eye className="h-2.5 w-2.5" /> vision
          </span>
        )}
        {m.capabilities.tools && (
          <span className="fxz-badge fxz-badge-warm gap-1">
            <Wrench className="h-2.5 w-2.5" /> tools
          </span>
        )}
        {m.capabilities.webSearch && (
          <span className="fxz-badge gap-1">
            <Globe className="h-2.5 w-2.5" /> web search
          </span>
        )}
        <span className="fxz-badge font-mono">{formatCtx(m.contextWindow)}</span>
      </div>

      {/* id pill + copy + Try in chat */}
      <div className="mt-auto flex items-center gap-2 pt-1 min-w-0 flex-wrap">
        <code
          className="fxz-code flex-1 min-w-0 truncate"
          title={m.id}
          aria-label={`Model id ${m.id}`}
        >
          {m.id}
        </code>
        <CopyIdButton value={m.id} />
        <Link
          href={`/chat?model=${encodeURIComponent(m.id)}`}
          className={
            "shrink-0 inline-flex items-center gap-1 font-mono text-[11px] font-bold px-3.5 h-10 rounded-md transition-all " +
            (emberRim
              ? "text-ember border border-ember/35 bg-ember/10 hover:bg-ember hover:text-black"
              : "text-crimson border border-crimson/35 bg-crimson/10 hover:bg-crimson hover:text-white")
          }
        >
          <MessageSquare className="h-3 w-3" /> Try in chat
        </Link>
      </div>
    </div>
  );
});

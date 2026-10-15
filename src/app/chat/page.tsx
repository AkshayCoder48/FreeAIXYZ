/**
 * /chat — Onyx fleet playground (FreeAIXYZ design).
 *
 * RSC. Serializes the STATIC Onyx fleet catalog (FLEET_CATALOG — bundled at
 * build time, no fetch, no discovery, no credentials) to the client island,
 * which owns the interactive chat surface (state machine, SSE streaming,
 * markdown render). Shell: floating pill nav + ambient backdrop + obsidian
 * panels.
 *
 * The `?model=` deep link is resolved server-side against FLEET_CATALOG
 * (legacy aliases like onyx-lust-v1 canonicalise to the renamed slot; invalid
 * or non-fleet ids fall back to DEFAULT_FLEET_MODEL_ID) and passed into the
 * island as the initial selection.
 */

import type { Metadata } from "next";

import {
  AuroraShell,
  AuroraPageHeader,
} from "@/components/aurora/shell";
import {
  ChatPlaygroundClient,
  type ChatPlaygroundData,
  type PlaygroundModel,
} from "@/components/playground/chat-playground-client";
import {
  FLEET_CATALOG,
  DEFAULT_FLEET_MODEL_ID,
  findFleetCatalogModel,
  type FleetCatalogModel,
} from "@/lib/native-catalog";
import { FLEET_FAMILIES } from "@/lib/onyx/families";

export const metadata: Metadata = {
  title: "Chat Playground — FreeAIXYZ",
  description:
    "Streaming chat playground with the Onyx AI fleet — 24 free models across ten families (Astra, Kairo, Vex, Logos, Codex, Omnix, Mythos, Amora). Real SSE deltas, tool calling, no API key required.",
};

interface ChatPageProps {
  searchParams: Promise<{ model?: string | string[] }>;
}

export default async function ChatPage({ searchParams }: ChatPageProps) {
  // Serialize the static fleet catalog to a plain JSON shape.
  const models: PlaygroundModel[] = FLEET_CATALOG.map((m: FleetCatalogModel) => ({
    id: m.id,
    legacyIds: m.legacyIds,
    name: m.name,
    family: m.family,
    familyName: m.familyName,
    variant: m.variant,
    version: m.version,
    releaseOrder: m.releaseOrder,
    category: m.category,
    contentClassification: m.contentClassification,
    brief: m.brief,
    description: m.description,
    uncensored: m.uncensored,
    providerName: m.providerName,
    capabilities: m.capabilities,
    contextWindow: m.contextWindow,
  }));

  // Resolve the ?model= deep link against the fleet catalog (server-side).
  // Legacy aliases resolve to their renamed slot's CANONICAL id so the
  // picker selects the right entry.
  const params = await searchParams;
  const raw = Array.isArray(params.model) ? params.model[0] : params.model;
  let requested = "";
  if (raw) {
    try {
      requested = decodeURIComponent(raw);
    } catch {
      requested = raw;
    }
  }
  const requestedEntry = requested ? findFleetCatalogModel(requested) : null;
  const initialModelId = requestedEntry
    ? requestedEntry.id
    : DEFAULT_FLEET_MODEL_ID;

  const data: ChatPlaygroundData = { models, initialModelId };

  const populatedFamilies = new Set(models.map((m) => m.family)).size;

  return (
    <AuroraShell>
      <div className="pt-10 sm:pt-14 flex flex-col gap-8 min-w-0">
        <AuroraPageHeader
          eyebrow="FreeAIXYZ // chat playground"
          title="Send a message. Watch it stream."
          gradientWord="stream"
          lede={
            <>
              {models.length} Onyx fleet models across {populatedFamilies} of
              the {FLEET_FAMILIES.length} families — from Astra and Codex to
              Mythos and Amora. Real token-by-token SSE deltas — no buffering,
              no re-pacing, no API key required. Toggle built-in tools and
              watch the model call them live.
            </>
          }
        />
        <ChatPlaygroundClient data={data} />
      </div>
    </AuroraShell>
  );
}

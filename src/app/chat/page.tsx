/**
 * /chat — Native models playground.
 *
 * RSC. Serializes the STATIC native model catalog (bundled at build time —
 * no fetch, no discovery, no credentials) to the client island, which owns
 * the interactive chat surface (state machine, SSE streaming, markdown render).
 */

import type { Metadata } from "next";

import { Nav } from "@/components/nav";
import { SectionLabel, SiteFooter, FadeIn } from "@/components/site";
import {
  ChatPlaygroundClient,
  type ChatPlaygroundData,
} from "@/components/playground/chat-playground-client";
import {
  OFFERED_MODELS,
  type NativeModel,
} from "@/lib/native-catalog";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Chat Playground — FreeAIXYZ",
  description:
    "Streaming chat playground with native free models. Real SSE deltas, token-by-token streaming, no API key required.",
};

export default function ChatPage() {
  // Serialize the static catalog to a plain JSON shape.
  const models = OFFERED_MODELS.map((m: NativeModel) => ({
    id: m.id,
    name: m.name,
    providerId: m.providerId,
    providerShortId: m.providerShortId,
    providerName: m.providerName,
    description: m.description,
    category: m.category,
    capabilities: m.capabilities,
    contextWindow: m.contextWindow,
  }));

  const data: ChatPlaygroundData = { models };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Nav />
      <main className="flex-1 mx-auto max-w-7xl w-full px-4 sm:px-6 py-8 sm:py-12 min-w-0 flex flex-col gap-6 min-h-0">
        <FadeIn className="flex flex-col gap-3">
          <SectionLabel dotColor="var(--chart-2, #10b981)">Chat playground</SectionLabel>
          <h1 className="text-4xl sm:text-5xl font-normal tracking-tight text-foreground mt-2">
            Send a message. Watch it{" "}
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-emerald-600 to-emerald-400">
              stream
            </span>
            .
          </h1>
          <p className="text-sm text-muted-foreground max-w-3xl leading-relaxed">
            {models.length} free native models from the static registry. Real
            SSE deltas — no buffering, no re-pacing, no API key required.
          </p>
        </FadeIn>
        <ChatPlaygroundClient data={data} />
      </main>
      <SiteFooter>
        <span
          className="font-mono"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          POST /api/v1/chat/completions · stream:true
        </span>
        <span
          className="font-mono"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          GET /api/v1/models
        </span>
      </SiteFooter>
    </div>
  );
}

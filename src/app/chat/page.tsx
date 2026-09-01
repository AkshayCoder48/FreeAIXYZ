/**
 * /chat — Native models playground (WARM AURORA design).
 *
 * RSC. Serializes the STATIC native model catalog (bundled at build time —
 * no fetch, no discovery, no credentials) to the client island, which owns
 * the interactive chat surface (state machine, SSE streaming, markdown render).
 * Shell: floating pill nav + dimmed living aurora + dark-glass panels.
 */

import type { Metadata } from "next";

import {
  AuroraShell,
  AuroraPageHeader,
} from "@/components/aurora/shell";
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
    "Streaming chat playground with native free models. Real SSE deltas, token-by-token streaming, tool calling — no API key required.",
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
    <AuroraShell>
      <div className="pt-10 sm:pt-14 flex flex-col gap-8 min-w-0">
        <AuroraPageHeader
          eyebrow="Chat playground"
          title="Send a message. Watch it stream."
          gradientWord="stream"
          lede={
            <>
              {models.length} free native models from the static registry. Real
              token-by-token SSE deltas — no buffering, no re-pacing, no API key
              required. Toggle built-in tools and watch the model call them live.
            </>
          }
        />
        <ChatPlaygroundClient data={data} />
      </div>
    </AuroraShell>
  );
}

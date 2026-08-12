/** Provider index: maps provider id → provider instance. */

import type { ProviderId } from "./registry";
import type { Provider } from "./types";
import { toolbazProvider } from "./toolbaz";
import { auroraAiProvider } from "./auroraai";
import { surfSenseProvider } from "./surfsense";
import { jollyGenProvider } from "./jollygen";
import { unlimitedAiProvider } from "./unlimitedai";
import { pollinationsProvider } from "./pollinations";
import { kiloCodeProvider } from "./kilocode";
import { llm7Provider } from "./llm7";
import { spicyWriterProvider } from "./spicywriter";
import { openCodeProvider } from "./opencode";
import { freeChatProvider } from "./freechat";
import { mikliumProvider } from "./miklium";
import { swarmProvider } from "./swarm";
import { freeaixyzProvider } from "./freeaixyz";
// FreeGPT provider is NOT imported here — it uses Node.js APIs (eval("require"),
// fs, path) that break Edge runtime. It's imported directly in the Node.js
// proxy route: /api/v1/chat/freegpt-proxy

// Stub providers for standalone services (search/music). These are listed in
// the model registry for discovery but called via their own API endpoints.
const stubProvider: Provider = {
  id: "toolbaz",
  async complete() {
    throw new Error("This is a standalone service. Use the dedicated API endpoint instead.");
  },
  async *stream() {
    throw new Error("This is a standalone service. Use the dedicated API endpoint instead.");
  },
};

export const PROVIDERS: Partial<Record<ProviderId, Provider>> = {
  toolbaz: toolbazProvider,
  auroraai: auroraAiProvider,
  surfsense: surfSenseProvider,
  jollygen: jollyGenProvider,
  unlimitedai: unlimitedAiProvider,
  pollinations: pollinationsProvider,
  kilocode: kiloCodeProvider,
  llm7: llm7Provider,
  spicywriter: spicyWriterProvider,
  opencode: openCodeProvider,
  freechat: freeChatProvider,
  miklium: mikliumProvider,
  swarm: swarmProvider,
  freeaixyz: freeaixyzProvider,
  // freegpt is handled via Node.js proxy route, not here
  search: stubProvider,
  music: stubProvider,
};

/** Get the provider instance for a given provider id. */
export function getProvider(id: ProviderId): Provider {
  const provider = PROVIDERS[id];
  if (!provider) {
    throw new Error(`Provider "${id}" is not available on this runtime. FreeGPT is handled via Node.js proxy route.`);
  }
  return provider;
}

export type { Provider, ProviderCompletionRequest, ProviderMessage } from "./types";
export {
  MODELS,
  findModel,
  resolveGatewayModel,
  DEFAULT_MODEL_ID,
  PROVIDER_INFO,
  type GatewayModel,
  type ModelCapabilities,
  type ProviderId,
} from "./registry";

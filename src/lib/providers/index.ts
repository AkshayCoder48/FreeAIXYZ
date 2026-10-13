/** Provider index: maps provider id → provider instance. */

import type { ProviderId } from "./registry";
import type { Provider } from "./types";
import { toolbazProvider } from "./toolbaz";
import { auroraAiProvider } from "./auroraai";
import { surfSenseProvider } from "./surfsense";
import { jollyGenProvider } from "./jollygen";
import { unlimitedAiProvider } from "./unlimitedai";
import { kiloCodeProvider } from "./kilocode";
import { llm7Provider } from "./llm7";
import { spicyWriterProvider } from "./spicywriter";
import { openCodeProvider } from "./opencode";
import { freeChatProvider } from "./freechat";
import { mikliumProvider } from "./miklium";
import { swarmProvider } from "./swarm";
import { freeaixyzProvider } from "./freeaixyz";
import { gptOssProvider } from "./gptoss";
import { vexaProvider } from "./vexa";
// Task 7 (v4): new free providers discovered via web research + live-tested.
import { uncloseAiProvider } from "./uncloseai";
import { free2GptProvider } from "./free2gpt";
import { novaProvider } from "./nova";
import { nsfwgfProvider } from "./nsfwgf";
// Task 4 (GPT-AI import, github.com/OshekharO/GPT-AI): scraper-backed free
// chat upstreams, live-tested 2026-10-13.
import { goody2Provider } from "./gptai-goody2";
import { chatSmithProvider } from "./gptai-chatsmith";
import { chatWithFictionProvider } from "./gptai-chatwithfiction";
import { bookaiProvider } from "./gptai-bookai";
import { publicaiProvider } from "./gptai-publicai";
import { doppleProvider } from "./gptai-dopple";
// FreeGPT provider is NOT imported here — it uses Node.js APIs (eval("require"),
// fs, path) that break Edge runtime. It's imported directly in the Node.js
// proxy route: /api/v1/chat/freegpt-proxy

export const PROVIDERS: Partial<Record<ProviderId, Provider>> = {
  toolbaz: toolbazProvider,
  auroraai: auroraAiProvider,
  surfsense: surfSenseProvider,
  jollygen: jollyGenProvider,
  unlimitedai: unlimitedAiProvider,
  kilocode: kiloCodeProvider,
  llm7: llm7Provider,
  spicywriter: spicyWriterProvider,
  opencode: openCodeProvider,
  freechat: freeChatProvider,
  miklium: mikliumProvider,
  swarm: swarmProvider,
  freeaixyz: freeaixyzProvider,
  gptoss: gptOssProvider,
  vexa: vexaProvider,
  // Task 7 (v4): new free providers.
  uncloseai: uncloseAiProvider,
  free2gpt: free2GptProvider,
  nova: novaProvider,
  nsfwgf: nsfwgfProvider,
  // Task 4 (GPT-AI import): new free providers.
  goody2: goody2Provider,
  chatsmith: chatSmithProvider,
  chatwithfiction: chatWithFictionProvider,
  bookai: bookaiProvider,
  publicai: publicaiProvider,
  dopple: doppleProvider,
  // freegpt is handled via Node.js proxy route, not here
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

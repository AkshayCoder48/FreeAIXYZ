/** Provider index: maps provider id → provider instance. */

import type { ProviderId } from "./registry";
import type { Provider } from "./types";
import { toolbazProvider } from "./toolbaz";
import { nsfwloverProvider } from "./nsfwlover";
import { surfSenseProvider } from "./surfsense";
import { jollyGenProvider } from "./jollygen";
import { unlimitedAiProvider } from "./unlimitedai";
import { pollinationsProvider } from "./pollinations";
import { kiloCodeProvider } from "./kilocode";
import { llm7Provider } from "./llm7";
import { heckAiProvider } from "./heckai";
import { spicyWriterProvider } from "./spicywriter";
import { g4fSpaceProvider } from "./g4fspace";

// Stub providers for standalone services (search/music). These are listed in
// the model registry for discovery but called via their own API endpoints,
// not via /v1/chat/completions. The stub just throws if someone tries to chat.
const stubProvider: Provider = {
  id: "toolbaz",
  async complete() {
    throw new Error("This is a standalone service. Use the dedicated API endpoint instead.");
  },
  async *stream() {
    throw new Error("This is a standalone service. Use the dedicated API endpoint instead.");
  },
};

export const PROVIDERS: Record<ProviderId, Provider> = {
  toolbaz: toolbazProvider,
  nsfwlover: nsfwloverProvider,
  surfsense: surfSenseProvider,
  jollygen: jollyGenProvider,
  unlimitedai: unlimitedAiProvider,
  pollinations: pollinationsProvider,
  kilocode: kiloCodeProvider,
  llm7: llm7Provider,
  heckai: heckAiProvider,
  spicywriter: spicyWriterProvider,

  search: stubProvider,
  music: stubProvider,
  // G4F.space — all owner-based provider ids route to the single
  // g4fSpaceProvider instance (Bearer auth with G4F key).
  easychat: g4fSpaceProvider,
  "ollama-swarm": g4fSpaceProvider,
  yqcloud: g4fSpaceProvider,
  wewordle: g4fSpaceProvider,
  "qwen-chat": g4fSpaceProvider,
  "pollinations-image": g4fSpaceProvider,
  "pollinations-g4f": g4fSpaceProvider,
  "perplexity-g4f": g4fSpaceProvider,
  "opera-aria": g4fSpaceProvider,
  openaifm: g4fSpaceProvider,
  huggingspace: g4fSpaceProvider,
  "bfl-flux": g4fSpaceProvider,
  anyprovider: g4fSpaceProvider,
  "api-airforce": g4fSpaceProvider,
  audio: g4fSpaceProvider,
  "cerebras-ai": g4fSpaceProvider,
  "community-day-2026": g4fSpaceProvider,
  "crowllm-com": g4fSpaceProvider,
  "deepinfra-com": g4fSpaceProvider,
  "gemini-cli": g4fSpaceProvider,
  "gemini-v1beta": g4fSpaceProvider,
  "gen-pollinations-ai": g4fSpaceProvider,
  "google-antigravity": g4fSpaceProvider,
  "groq-com": g4fSpaceProvider,
  "kobold-llamacpp-swarm": g4fSpaceProvider,
  ktai: g4fSpaceProvider,
  "modelscope-ai": g4fSpaceProvider,
  "nectar-pollinations-ai": g4fSpaceProvider,
  "nvidia-com": g4fSpaceProvider,
  "ollama-com": g4fSpaceProvider,
  "ollama-pro": g4fSpaceProvider,
  "opencode-ai-zen": g4fSpaceProvider,
  "openrouter-ai": g4fSpaceProvider,
  perplexity: g4fSpaceProvider,
  "pollinations-ai": g4fSpaceProvider,
  qwen: g4fSpaceProvider,

};

/** Get the provider instance for a given provider id. */
export function getProvider(id: ProviderId): Provider {
  const p = PROVIDERS[id];
  if (!p) {
    // Fallback: route unknown G4F owner ids to the g4fSpaceProvider
    return g4fSpaceProvider;
  }
  return p;
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

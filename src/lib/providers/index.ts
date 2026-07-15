/** Provider index: maps provider id → provider instance. */

import type { ProviderId } from "./registry";
import type { Provider } from "./types";
import { toolbazProvider } from "./toolbaz";
import { nsfwloverProvider } from "./nsfwlover";
import { freeAiOnlineProvider } from "./free-ai-online";
import { surfSenseProvider } from "./surfsense";
import { jollyGenProvider } from "./jollygen";
import { unlimitedAiProvider } from "./unlimitedai";
import { theOldLlmProvider } from "./theoldllm";

export const PROVIDERS: Record<ProviderId, Provider> = {
  toolbaz: toolbazProvider,
  nsfwlover: nsfwloverProvider,
  freeaionline: freeAiOnlineProvider,
  surfsense: surfSenseProvider,
  jollygen: jollyGenProvider,
  unlimitedai: unlimitedAiProvider,
  theoldllm: theOldLlmProvider,
};

/** Get the provider instance for a given provider id. */
export function getProvider(id: ProviderId): Provider {
  return PROVIDERS[id];
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
  type ProviderId as ProviderIdType,
} from "./registry";

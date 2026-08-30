import type { ProviderModelAdapter } from "../types";
import { discover } from "./discover";
import { normalizeModel } from "./normalize";
import { classifyFree } from "./free";

export const freeaixyzAdapter: ProviderModelAdapter = {
  id: "freeaixyz",
  name: "FreeAIXYZ",
  pricingMode: "entirely_free",
  fetchModels: discover,
  normalizeModel,
  classifyFree,
};

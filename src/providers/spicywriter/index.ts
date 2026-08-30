import type { ProviderModelAdapter } from "../types";
import { discover } from "./discover";
import { normalizeModel } from "./normalize";
import { classifyFree } from "./free";

export const spicywriterAdapter: ProviderModelAdapter = {
  id: "spicywriter",
  name: "SpicyWriter",
  pricingMode: "pattern",
  fetchModels: discover,
  normalizeModel,
  classifyFree,
};

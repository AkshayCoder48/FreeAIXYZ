import type { ProviderModelAdapter } from "../types";
import { discover } from "./discover";
import { normalizeModel } from "./normalize";
import { classifyFree } from "./free";

export const freegptAdapter: ProviderModelAdapter = {
  id: "freegpt",
  name: "FreeGPT",
  pricingMode: "pattern",
  fetchModels: discover,
  normalizeModel,
  classifyFree,
};

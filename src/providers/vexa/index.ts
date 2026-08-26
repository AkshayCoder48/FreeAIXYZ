import type { ProviderModelAdapter } from "../types";
import { discover } from "./discover";
import { normalizeModel } from "./normalize";
import { classifyFree } from "./free";

export const vexaAdapter: ProviderModelAdapter = {
  id: "vexa",
  name: "Vexa",
  pricingMode: "entirely_free",
  fetchModels: discover,
  normalizeModel,
  classifyFree,
};

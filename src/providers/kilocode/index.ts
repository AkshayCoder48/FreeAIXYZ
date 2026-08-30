import type { ProviderModelAdapter } from "../types";
import { discover } from "./discover";
import { normalizeModel } from "./normalize";
import { classifyFree } from "./free";

export const kilocodeAdapter: ProviderModelAdapter = {
  id: "kilocode",
  name: "Kilo Code",
  pricingMode: "pattern",
  fetchModels: discover,
  normalizeModel,
  classifyFree,
};

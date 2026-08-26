import type { ProviderModelAdapter } from "../types";
import { discover } from "./discover";
import { normalizeModel } from "./normalize";
import { classifyFree } from "./free";

export const pollinationsAdapter: ProviderModelAdapter = {
  id: "pollinations",
  name: "Pollinations",
  pricingMode: "entirely_free",
  fetchModels: discover,
  normalizeModel,
  classifyFree,
};

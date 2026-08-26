import type { ProviderModelAdapter } from "../types";
import { discover } from "./discover";
import { normalizeModel } from "./normalize";
import { classifyFree } from "./free";

export const unlimitedaiAdapter: ProviderModelAdapter = {
  id: "unlimitedai",
  name: "UnlimitedAI",
  pricingMode: "entirely_free",
  fetchModels: discover,
  normalizeModel,
  classifyFree,
};

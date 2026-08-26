import type { ProviderModelAdapter } from "../types";
import { discover } from "./discover";
import { normalizeModel } from "./normalize";
import { classifyFree } from "./free";

export const toolbazAdapter: ProviderModelAdapter = {
  id: "toolbaz",
  name: "Toolbaz",
  pricingMode: "entirely_free",
  fetchModels: discover,
  normalizeModel,
  classifyFree,
};

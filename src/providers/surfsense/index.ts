import type { ProviderModelAdapter } from "../types";
import { discover } from "./discover";
import { normalizeModel } from "./normalize";
import { classifyFree } from "./free";

export const surfsenseAdapter: ProviderModelAdapter = {
  id: "surfsense",
  name: "SurfSense",
  pricingMode: "entirely_free",
  fetchModels: discover,
  normalizeModel,
  classifyFree,
};

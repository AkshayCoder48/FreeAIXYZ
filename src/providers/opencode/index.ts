import type { ProviderModelAdapter } from "../types";
import { discover } from "./discover";
import { normalizeModel } from "./normalize";
import { classifyFree } from "./free";

export const opencodeAdapter: ProviderModelAdapter = {
  id: "opencode",
  name: "OpenCode",
  pricingMode: "pattern",
  fetchModels: discover,
  normalizeModel,
  classifyFree,
};

import type { ProviderModelAdapter } from "../types";
import { discover } from "./discover";
import { normalizeModel } from "./normalize";
import { classifyFree } from "./free";

export const llm7Adapter: ProviderModelAdapter = {
  id: "llm7",
  name: "LLM7",
  pricingMode: "hybrid",
  fetchModels: discover,
  normalizeModel,
  classifyFree,
};

/**
 * JollyGen discoverer — `https://jollygenapi.space/ai/chat-guest` is a chat
 * endpoint with NO /models listing. Single model slug `jollygen`.
 * Rotated guest_hash per request → effectively unlimited free.
 */
import { manualModels } from "../_shared";

const IDS = ["jollygen"];

export async function discover() {
  return manualModels(IDS, {
    source: "manual",
    endpoint: "https://jollygenapi.space/ai/chat-guest",
    note: "jollygen has no /models endpoint; single slug",
  });
}

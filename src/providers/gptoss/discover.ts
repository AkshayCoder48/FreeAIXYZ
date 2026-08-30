/**
 * GPT-OSS discoverer — Cloudflare Worker stub returns 200 OK with EMPTY
 * content for every prompt (audit confirmed the inference backend is gone).
 *
 * The `/v1/models` endpoint returns a stub listing — we surface both known
 * models (gpt-oss-120b, gpt-oss-20b) but mark them all temporarily
 * unavailable so the catalog shows them as offline rather than producing
 * confusing empty responses.
 */
import { manualModels } from "../_shared";

const IDS = ["gpt-oss-120b", "gpt-oss-20b"];

export async function discover() {
  return manualModels(IDS, {
    source: "manual",
    endpoint: "https://broken-water-d859.junioralive.workers.dev",
    note: "gptoss worker is a stub (returns empty content) — marked offline",
  });
}

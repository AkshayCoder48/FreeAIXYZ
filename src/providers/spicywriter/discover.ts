/**
 * SpicyWriter discoverer — `https://spicywriter.com/api/llm/models`
 * (anonymous, no auth needed — endpoint accepts X-Anonymous-User-Id).
 *
 * Returns a JSON array of model objects with rich metadata:
 *   - `id`        — numeric upstream id
 *   - `name`      — model display name (passed verbatim to the chat payload
 *                   as `model` field — this is the upstream "model id")
 *   - `tierType`  — "LITE" | "BALANCED" | "ADVANCED"
 *   - `requiredTier` — null (free anon) | "BASIC" (anon BASIC) | "PRO" (paid)
 *   - `isActive`  — boolean
 *   - `legacy`     — boolean (legacy section)
 *   - `costPerRequest` — numeric (points)
 *
 * LIVE FETCH every refresh so newly added models (e.g. "Ox Alpha" — the
 * "0x" model the user mentioned, "Gemma 4 31B T", etc.) appear automatically.
 * NO hardcoding of model names — PRD §21.
 */
import { fetchModelsJson } from "../_shared";
import type { ProviderModel } from "../types";

const URL = "https://spicywriter.com/api/llm/models";

const ANON_HEADERS = {
  "X-Anonymous-User-Id": "anon_discovery",
  "X-Client-Diag": JSON.stringify({
    csrf: false,
    uid: null,
    lastUid: null,
    authed: false,
    sinceCsrfMs: null,
    persisted: false,
    resumeMs: null,
    pwa: false,
    online: true,
  }),
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
};

/**
 * Fetch the live SpicyWriter model list. Items use `name` as the upstream
 * id (the chat payload's `model` field expects the human-readable name like
 * "Ox Alpha" or "Ling 2.6 Flash", not the numeric `id`).
 */
export async function discover(): Promise<ProviderModel[]> {
  const items = await fetchModelsJson(URL, {
    timeoutMs: 15_000,
    headers: ANON_HEADERS,
    idField: "name", // model name is what gets sent to the chat endpoint
  });
  return items.filter((m) => {
    // Only surface active models — the endpoint includes legacy/preview
    // entries; the chat adapter can't call inactive ones anyway.
    const raw = m.raw as { isActive?: boolean } | null;
    return raw?.isActive !== false;
  });
}

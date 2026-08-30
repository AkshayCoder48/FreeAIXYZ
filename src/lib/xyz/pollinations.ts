/**
 * Pollinations BYOK adapter.
 *
 * The user supplies a Pollinations app token (Bearer). We validate it
 * against the Pollinations models endpoint and (optionally) discover the
 * model list for the catalog.
 *
 * Endpoints:
 *   Models:  GET  https://text.pollinations.ai/models
 *            (accepts Authorization: Bearer <token>; no-auth also works for
 *             the public list, but sending the token validates it)
 *   Chat:    POST https://text.pollinations.ai/v1/chat/completions
 *            (OpenAI-shaped; the native provider adapter in
 *             src/lib/providers/pollinations.ts handles streaming)
 *
 * The user will provide their app token afterwards — the BYOK card is wired
 * up now so they can paste it when ready. For the OAuth "Connect" flow
 * (Pollinations BYOP with commission), register this callback URI in the
 * Pollinations dashboard:
 *   https://freeaixyz4all.vercel.app/api/v1/byok/pollinations/connect
 */

export interface DiscoveredPollinationsModel {
  upstreamId: string;
  name: string;
  description?: string;
  capabilities: string[];
  contextLength?: number;
  modality?: string;
  rawMetadata?: Record<string, unknown>;
}

export interface PollinationsValidationResult {
  ok: boolean;
  error?: string;
  modelCount?: number;
}

const MODELS_URL = "https://text.pollinations.ai/models";
const TIMEOUT_MS = 12_000;

/** Validate a Pollinations token by fetching the models list. */
export async function validatePollinationsKey(
  key: string,
): Promise<PollinationsValidationResult> {
  const trimmed = key.trim();
  if (!trimmed) {
    return { ok: false, error: "No key provided." };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(MODELS_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${trimmed}`,
        Accept: "application/json",
      },
      signal: ctrl.signal,
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "Pollinations rejected this token (unauthorized)." };
    }
    if (!res.ok) {
      return {
        ok: false,
        error: `Pollinations returned HTTP ${res.status}.`,
      };
    }
    // 200 — token is valid. Count the models.
    const data = await res.json().catch(() => null);
    let modelCount = 0;
    if (Array.isArray(data)) {
      modelCount = data.length;
    } else if (data && typeof data === "object" && Array.isArray((data as { models?: unknown }).models)) {
      modelCount = ((data as { models: unknown[] }).models).length;
    }
    return { ok: true, modelCount };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Network error";
    return { ok: false, error: `Could not reach Pollinations: ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}

/** Discover Pollinations models for the catalog (best-effort). */
export async function discoverPollinationsModels(
  key?: string,
): Promise<DiscoveredPollinationsModel[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (key) headers.Authorization = `Bearer ${key}`;
    const res = await fetch(MODELS_URL, {
      method: "GET",
      headers,
      signal: ctrl.signal,
    });
    if (!res.ok) return [];
    const data = await res.json().catch(() => null);
    const list: unknown[] = Array.isArray(data)
      ? data
      : data && typeof data === "object" && Array.isArray((data as { models?: unknown[] }).models)
        ? (data as { models: unknown[] }).models
        : [];
    return list.map((raw) => {
      const obj = (raw ?? {}) as Record<string, unknown>;
      const id = (obj.id as string) ?? (obj.name as string) ?? "pollinations-model";
      const name = (obj.name as string) ?? id;
      const desc = (obj.description as string) ?? undefined;
      const capsRaw = obj.capabilities;
      const caps = Array.isArray(capsRaw)
        ? capsRaw.map((c) => String(c))
        : ["text"];
      const ctx = typeof obj.context_length === "number" ? obj.context_length : undefined;
      const mod = typeof obj.modality === "string" ? obj.modality : "language";
      return {
        upstreamId: id,
        name,
        description: desc,
        capabilities: caps,
        contextLength: ctx,
        modality: mod,
        rawMetadata: obj,
      };
    });
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

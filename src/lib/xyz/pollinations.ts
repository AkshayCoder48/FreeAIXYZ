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
const USERINFO_URL = "https://enter.pollinations.ai/api/device/userinfo";
const TIMEOUT_MS = 12_000;

/**
 * Validate a Pollinations token.
 *
 * IMPORTANT: text.pollinations.ai/models is PUBLIC — it returns 200 with a
 * model list even when no Authorization header is supplied. So calling it
 * with a fake Bearer token also returns 200 and a naive validator would
 * accept any string as "valid". To actually distinguish valid from invalid
 * tokens we hit the authenticated userinfo endpoint instead — it returns
 * 401 for missing/invalid tokens and 200 with `{ sub, preferred_username,
 * picture, ... }` for valid ones.
 */
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
    // 1) Real validation: the userinfo endpoint requires a valid Bearer
    //    token and 401s otherwise. This is the only way to reject fake keys.
    const userRes = await fetch(USERINFO_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${trimmed}`, Accept: "application/json" },
      signal: ctrl.signal,
    });
    if (userRes.status === 401 || userRes.status === 403) {
      return { ok: false, error: "Pollinations rejected this token (unauthorized)." };
    }
    if (!userRes.ok) {
      return { ok: false, error: `Pollinations returned HTTP ${userRes.status}.` };
    }
    // 200 — token is valid. Count the models from the public list endpoint.
    let modelCount = 0;
    try {
      const modelsRes = await fetch(MODELS_URL, {
        method: "GET",
        headers: { Authorization: `Bearer ${trimmed}`, Accept: "application/json" },
        signal: ctrl.signal,
      });
      if (modelsRes.ok) {
        const data = await modelsRes.json().catch(() => null);
        if (Array.isArray(data)) {
          modelCount = data.length;
        } else if (data && typeof data === "object" && Array.isArray((data as { models?: unknown }).models)) {
          modelCount = ((data as { models: unknown[] }).models).length;
        }
      }
    } catch {
      // model count is best-effort; the key itself is valid.
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

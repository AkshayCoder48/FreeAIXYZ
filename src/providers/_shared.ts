/**
 * Shared fetch helpers for provider discoverers (Task 11-backend).
 *
 * Tiny utilities duplicated from `dynamic-discovery.ts` for isolation —
 * the legacy discovery file is intentionally not modified (chat adapters
 * depend on it). Each provider's discover.ts calls these.
 */

import type { ProviderModel } from "./types";

/**
 * GET `<url>` with a per-call AbortController timeout. Returns the parsed
 * JSON body. Supports OpenAI-shaped `{data:[]}`, `{models:[]}`, or a bare
 * array (PRD §22). Item field can be `id` or `name`.
 *
 * NEVER throws — returns `[]` on any failure (network, parse, non-2xx).
 */
export async function fetchModelsJson(
  url: string,
  opts: {
    timeoutMs?: number;
    headers?: Record<string, string>;
    idField?: "id" | "name" | ((item: Record<string, unknown>) => string | undefined);
  } = {},
): Promise<ProviderModel[]> {
  const { timeoutMs = 10_000, headers = {}, idField = "id" } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json", ...headers },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const json: unknown = await res.json();
    let items: Record<string, unknown>[] = [];
    if (Array.isArray(json)) {
      items = json as Record<string, unknown>[];
    } else if (json && typeof json === "object") {
      const obj = json as { data?: Record<string, unknown>[]; models?: Record<string, unknown>[] };
      items = obj.data ?? obj.models ?? [];
    }
    const out: ProviderModel[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      const id =
        typeof idField === "function"
          ? idField(item)
          : (item[idField] as string | undefined) ?? (item.id as string | undefined);
      if (!id || typeof id !== "string") continue;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, name: (item.name as string | undefined) ?? id, raw: item });
    }
    return out;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Convert a list of bare upstream ids into `ProviderModel[]` (manual
 * discovery — for providers with no upstream /models endpoint).
 */
export function manualModels(ids: string[], rawMeta: Record<string, unknown> = {}): ProviderModel[] {
  return ids.map((id) => ({ id, name: id, raw: { id, ...rawMeta } }));
}

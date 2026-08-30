/**
 * OnyxBase persistence client.
 *
 * Implements the documented OnyxBase KV contract (researched R3, see
 * /home/z/my-project/worklog.md). The service is a Telegram-backed KV store
 * at https://onyxbase.vercel.app with an OpenAPI spec at /api/openapi.json.
 *
 * Contract:
 *   Auth: Authorization: Bearer <kv_live_*>
 *   POST   /v1/set              body {key,value,collection?} → upsert Record
 *   GET    /v1/get/{key}?collection=... → Record (404 if missing)
 *   DELETE /v1/delete/{key}?collection=... → {ok:true}
 *   GET    /v1/list?collection=...        → array of keys
 *   GET    /v1/export?collection=...      → {key: value, ...}
 *   GET    /v1/collections                 → array of collection names
 *
 * NO native prefix scan (filter client-side) and NO conditional CAS — the
 * atomic daily-grant uses a key-existence gate + a ledger for idempotency.
 *
 * Security (PRD §8, §10): the API key is read from the server env
 * ONYXBASE_API_KEY. NEVER expose it to the browser. The client is server-only.
 */

const ONYXBASE_URL = process.env.ONYXBASE_URL ?? "https://onyxbase.vercel.app";

function apiKey(): string {
  const k = process.env.ONYXBASE_API_KEY;
  if (!k) {
    // Fail loud at call time — never embed a real key in source.
    throw new Error(
      "ONYXBASE_API_KEY is not set. Configure it in the Vercel project env.",
    );
  }
  return k;
}

export interface OnyxRecord {
  key: string;
  value: unknown;
  valueType?: string;
  collection?: string;
  updatedAt?: string;
  createdAt?: string;
}

class OnyxBaseClient {
  private async req(
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey()}`,
      ...(init.headers as Record<string, string> | undefined),
    };
    if (init.body && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    const res = await fetch(`${ONYXBASE_URL}${path}`, {
      ...init,
      headers,
      // Don't leak credentials via signal abort logs.
    });
    return res;
  }

  /** Set (upsert) a key in a collection. */
  async set(
    key: string,
    value: unknown,
    collection = "freeaixyz",
  ): Promise<OnyxRecord | null> {
    try {
      const res = await this.req(`/v1/set`, {
        method: "POST",
        body: JSON.stringify({ key, value, collection }),
      });
      if (!res.ok) return null;
      return (await res.json()) as OnyxRecord;
    } catch {
      return null;
    }
  }

  /** Get a key. Returns null if missing or errored. */
  async get<T = unknown>(
    key: string,
    collection = "freeaixyz",
  ): Promise<T | null> {
    try {
      const res = await this.req(
        `/v1/get/${encodeURIComponent(key)}?collection=${encodeURIComponent(collection)}`,
        { method: "GET" },
      );
      if (res.status === 404) return null;
      if (!res.ok) return null;
      const rec = (await res.json()) as OnyxRecord;
      return (rec.value as T) ?? null;
    } catch {
      return null;
    }
  }

  /** Get the raw record (with metadata). */
  async getRecord(
    key: string,
    collection = "freeaixyz",
  ): Promise<OnyxRecord | null> {
    try {
      const res = await this.req(
        `/v1/get/${encodeURIComponent(key)}?collection=${encodeURIComponent(collection)}`,
        { method: "GET" },
      );
      if (res.status === 404) return null;
      if (!res.ok) return null;
      return (await res.json()) as OnyxRecord;
    } catch {
      return null;
    }
  }

  /** Delete a key. */
  async delete(
    key: string,
    collection = "freeaixyz",
  ): Promise<boolean> {
    try {
      const res = await this.req(
        `/v1/delete/${encodeURIComponent(key)}?collection=${encodeURIComponent(collection)}`,
        { method: "DELETE" },
      );
      return res.ok;
    } catch {
      return false;
    }
  }

  /** List keys in a collection (no native prefix — filter client-side). */
  async listKeys(collection = "freeaixyz"): Promise<string[]> {
    try {
      const res = await this.req(
        `/v1/list?collection=${encodeURIComponent(collection)}`,
        { method: "GET" },
      );
      if (!res.ok) return [];
      const data = await res.json();
      if (Array.isArray(data)) return data as string[];
      if (data && Array.isArray((data as Record<string, unknown>).keys)) {
        return (data as { keys: string[] }).keys;
      }
      return [];
    } catch {
      return [];
    }
  }

  /** Export a whole collection as {key: value}. */
  async exportCollection(
    collection = "freeaixyz",
  ): Promise<Record<string, unknown>> {
    try {
      const res = await this.req(
        `/v1/export?collection=${encodeURIComponent(collection)}`,
        { method: "GET" },
      );
      if (!res.ok) return {};
      return (await res.json()) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  /** List keys in a collection that start with a prefix (client-side filter). */
  async listByPrefix(
    prefix: string,
    collection = "freeaixyz",
  ): Promise<string[]> {
    const all = await this.listKeys(collection);
    return all.filter((k) => k.startsWith(prefix));
  }

  /** Probe whether OnyxBase is reachable + the key is valid (PRD §63). */
  async ping(): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await this.req(`/v1/collections`, { method: "GET" });
      if (res.ok) return { ok: true };
      const txt = await res.text().catch(() => "");
      return { ok: false, error: `HTTP ${res.status}: ${txt.slice(0, 120)}` };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

export const onyxbase = new OnyxBaseClient();

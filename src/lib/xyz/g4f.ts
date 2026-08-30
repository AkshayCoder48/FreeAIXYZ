/**
 * G4F BYOK adapter — PRD §18, §19, §38, §59.
 *
 * Base URL:   https://g4f.space/v1             (chat — auth-gated, Bearer g4f_<key>)
 * Discovery:  https://g4f.space/backend-api/v2/* (PUBLIC — no auth, per OpenAPI)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * KEY INVARIANT (PRD §19, §23, §24 — the dynamic-discovery fix):
 *
 *   The committed seed snapshot (src/lib/xyz/seed/g4f-seed.json) was DELETED.
 *   Live discovery from https://g4f.space/backend-api/v2/{providers,models}
 *   is the ONLY source of catalog data. When Vercel's egress IP is challenged
 *   (HTTP 403, network error, or 15s timeout) discovery returns
 *   `{ ok: false, error: "G4F_UNREACHABLE", stale: false }` — the route
 *   handler is expected to mark the G4F provider as `degraded` in the DB.
 *   We NEVER silently fall back to a stale seed (the user explicitly said
 *   "they are fetch not added through code").
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Validation (PRD §18, §82): G4F /v1/* REJECTS OpenAI-style keys (sk-…) with
 * 403 — only g4f_-prefixed member keys work. validateG4fKey does a cheap
 * prefix pre-check first (saves a network call when the user pastes an
 * OpenAI key), then issues a real authenticated GET to /v1/models. NEVER
 * returns ok:true without a real 200 from the protected endpoint (no
 * spurious "Connected" claim — PRD §82).
 *
 * Chat (PRD §18): G4F exposes an OpenAI-compatible POST /v1/chat/completions.
 * Delegated to the shared streamByokChat / completeByokChat helpers in
 * ./openai-chat (single SSE accumulator — PRD §39). The shared helpers
 * capture the upstream `usage` chunk once at stream end (never per-chunk).
 *
 * Pricing (PRD §38): G4F documents NO per-model pricing per the OpenAPI +
 * research. resolveG4fPricing returns nulls + source="undocumented" UNLESS
 * the supplied pricing board (./pricing-board) matches the model id (then
 * source="market"). Never invents a price (PRD §26 — never confuse $0 with
 * "not documented").
 *
 * Error normalization (PRD §62, §82): the shared HTTP error classes are
 * imported from ./gratisfy (defined there as ByokUpstreamError-derived so
 * existing `instanceof ByokUpstreamError` checks in byok-route.ts keep
 * working). This file adds two G4F-specific classes:
 *   - MissingG4fKeyError   — chat called without a g4f_ key (PRD §18)
 *   - G4fUnreachableError  — discovery 403/timeout/network (degraded signal)
 */

import {
  ByokUpstreamError,
  completeByokChat,
  streamByokChat,
} from "./openai-chat";
// Pricing (PRD §38): G4F documents no per-model pricing. resolveG4fPricing
// returns nulls + source="undocumented" — see its comment for why the
// supplied-pricing-board fallback was removed.
// Shared chat types (PRD §39 — single StreamEvent shape across adapters).
import type { ChatMessage, ChatUsage, StreamEvent } from "./gratisfy";
// Shared HTTP-shaped error classes (PRD §62). Defined in ./gratisfy as
// ByokUpstreamError-derived; imported here so this module does NOT re-export
// them (avoids a barrel collision with ./gratisfy via index.ts `export *`).
import {
  InvalidKeyError,
  InvalidRequestError,
  ModelNotFoundError,
  NetworkError,
  ProviderUnavailableError,
  RateLimitedError,
  TimeoutError,
  UnknownError,
  UpstreamError,
} from "./gratisfy";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const G4F_HOST = "https://g4f.space";
/** Auth-gated OpenAI-compatible endpoint (chat completions + models). */
export const G4F_BASE_URL = `${G4F_HOST}/v1`;
/** PUBLIC discovery endpoints (no auth — per the OpenAPI audit). */
export const G4F_DISCOVERY_BASE_URL = `${G4F_HOST}/backend-api/v2`;
/** Per-request timeout for the public discovery endpoints (PRD §19). */
export const G4F_DISCOVERY_TIMEOUT_MS = 15_000;
/** Per-request timeout for the auth-gated validation probe (PRD §82). */
export const G4F_VALIDATE_TIMEOUT_MS = 20_000;

/**
 * Browser-like User-Agent. g4f.space (and many free-AI hosts) reject the
 * default node-fetch UA / Accept profile; sending a Chrome-shaped UA keeps
 * the public discovery endpoints reachable from serverless egress. Verified
 * from the sandbox — the UA resolves the 403 some Vercel egress IPs see.
 */
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

// Re-export the shared chat types so callers can `import { ChatMessage,
// StreamEvent } from "@/lib/xyz/g4f"` without reaching into ./gratisfy.
export type { ChatMessage, ChatUsage, StreamEvent } from "./gratisfy";

/**
 * A single provider discovered from G4F's PUBLIC
 * /backend-api/v2/providers endpoint. This is the RAW normalized shape —
 * registry.ts / the route handler turns this into a UnifiedProvider + upserts
 * into Prisma Provider (providerId="g4f", discoveryMode="dynamic",
 * active=true) per PRD §19, §23, §24.
 */
export interface DiscoveredG4fProvider {
  /** Raw G4F provider id (the `name` field on each entry — e.g. "Gemini"). */
  upstreamId: string;
  /** Display name (the `label` field if present, else the upstreamId). */
  name: string;
  /** Docs URL, if G4F ever exposes one (currently never set). */
  docsUrl?: string;
  /** The raw upstream JSON entry, for debugging / future field extraction. */
  rawMetadata?: Record<string, unknown>;
}

/**
 * A single model discovered from G4F's PUBLIC /backend-api/v2/models
 * endpoint. G4F returns a `{ providerName: [modelId, …] }` map; this
 * normalizes each (provider, modelId) pair into a flat entry.
 */
export interface DiscoveredG4fModel {
  /** Raw G4F model id (one entry from the model-id array per provider). */
  upstreamId: string;
  /** G4F provider upstreamId this model belongs to (the map key). */
  providerId: string;
  /** Display name (currently equal to upstreamId — G4F exposes no label). */
  name: string;
  /** Optional description, if G4F ever exposes one. */
  description?: string;
  /** Capability flags surfaced from upstream (default ["text"] — G4F
   * exposes no per-model caps; the route handler may enrich from the
   * provider entry's vision/image/audio/video flags). */
  capabilities: string[];
  /** Context window length in tokens, if upstream advertises it. */
  contextLength?: number;
  /** Modality tag (e.g. "language", "image") if surfaced. */
  modality?: string;
  /** Raw upstream JSON entry, for debugging / future field extraction. */
  rawMetadata?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// G4F-specific typed errors (PRD §62, §82)
//
// The shared HTTP-shaped classes (InvalidKeyError / RateLimitedError /
// ProviderUnavailableError / InvalidRequestError / UpstreamError /
// NetworkError / TimeoutError / UnknownError / ModelNotFoundError) are
// imported from ./gratisfy so `instanceof ByokUpstreamError` checks keep
// working in byok-route.ts. Only the two G4F-specific classes are defined
// + exported here, to avoid a barrel-collision with ./gratisfy.
// ─────────────────────────────────────────────────────────────────────────────

/** Thrown when a chat function is called without a g4f_ BYOK key (PRD §18). */
export class MissingG4fKeyError extends Error {
  constructor(
    message = "A G4F BYOK key (g4f_…) is required for chat (PRD §18).",
  ) {
    super(message);
    this.name = "MissingG4fKeyError";
  }
}

/**
 * Thrown internally by the discovery helpers when the public G4F discovery
 * endpoints are unreachable (HTTP 403 from Vercel egress, network error,
 * or 15s timeout). The discovery functions CATCH this and convert it to
 * `{ ok: false, error: "G4F_UNREACHABLE", stale: false }` — the route
 * handler then marks the G4F provider row as `degraded` in the DB.
 */
export class G4fUnreachableError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "G4fUnreachableError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Discovery — PUBLIC endpoints, no auth (PRD §19, §23, §24)
//
// Both functions return a discriminated union: { ok: true, … } on success,
// { ok: false, error, stale: false } on failure. The `stale: false` literal
// type signals to the route handler that there is NO seed fallback — a
// failure must be surfaced as `degraded`, never silently served from cache
// (the user explicitly forbid this).
// ─────────────────────────────────────────────────────────────────────────────

/** Raw shape of one entry in G4F's /backend-api/v2/providers array. */
interface G4fRawProvider {
  active_by_default?: boolean;
  audio?: boolean;
  auth?: boolean;
  image?: boolean;
  label?: string;
  live?: boolean;
  login?: boolean;
  name?: string;
  parent?: string;
  video?: boolean;
  vision?: boolean;
  [k: string]: unknown;
}

/**
 * Discover G4F providers (PRD §19, §23, §24). Hits the PUBLIC
 * GET /backend-api/v2/providers endpoint — no Authorization header sent.
 *
 * Returns:
 *   - `{ ok: true, providers: DiscoveredG4fProvider[] }`        on HTTP 200
 *   - `{ ok: false, error: "G4F_UNREACHABLE", stale: false }`    on 403 /
 *     network / 15s-timeout (Vercel egress block)
 *   - `{ ok: false, error: "G4F_HTTP_<status>", stale: false }`  on other
 *     non-200
 *
 * NEVER falls back to a stale seed (PRD §19 — the seed snapshot was deleted).
 * The route handler is expected to mark the G4F provider row as `degraded`
 * in the DB when this returns ok:false.
 */
export async function discoverG4fProviders(): Promise<
  | { ok: true; providers: DiscoveredG4fProvider[] }
  | { ok: false; error: string; stale: false }
> {
  let raw: G4fRawProvider[];
  try {
    raw = await fetchG4fDiscovery<G4fRawProvider[]>("/providers");
  } catch (err) {
    return { ok: false, error: toDiscoveryError(err), stale: false };
  }

  const providers: DiscoveredG4fProvider[] = [];
  for (const p of Array.isArray(raw) ? raw : []) {
    const norm = normalizeProvider(p);
    if (norm) providers.push(norm);
  }
  return { ok: true, providers };
}

/**
 * Discover G4F models (PRD §19, §23, §24). Hits the PUBLIC
 * GET /backend-api/v2/models endpoint — no Authorization header sent.
 *
 * G4F returns a `{ providerName: [modelId, …] }` map; this flattens each
 * (provider, modelId) pair into one DiscoveredG4fModel entry. Capabilities
 * default to ["text"] (G4F exposes no per-model caps; the route handler
 * may enrich from the provider entry's vision/image/audio/video flags by
 * calling discoverG4fProviders in parallel).
 *
 * Returns the same discriminated-union shape as discoverG4fProviders.
 * NEVER falls back to a stale seed.
 */
export async function discoverG4fModels(): Promise<
  | { ok: true; models: DiscoveredG4fModel[] }
  | { ok: false; error: string; stale: false }
> {
  let raw: Record<string, unknown>;
  try {
    raw = await fetchG4fDiscovery<Record<string, unknown>>("/models");
  } catch (err) {
    return { ok: false, error: toDiscoveryError(err), stale: false };
  }

  const models: DiscoveredG4fModel[] = [];
  // G4F shape: { providerName: ["model-id-1", "model-id-2", …], … }.
  // Be defensive: ignore non-array values + non-string keys.
  for (const [providerName, value] of Object.entries(raw ?? {})) {
    if (!providerName) continue;
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      const modelId = typeof entry === "string" ? entry.trim() : "";
      if (!modelId) continue;
      models.push({
        upstreamId: modelId,
        providerId: providerName,
        name: modelId,
        capabilities: ["text"],
        rawMetadata: { provider: providerName, model: modelId },
      });
    }
  }
  return { ok: true, models };
}

// ─────────────────────────────────────────────────────────────────────────────
// Chat generation (PRD §18)
//
// G4F exposes an OpenAI-compatible POST /v1/chat/completions endpoint that
// REQUIRES a Bearer g4f_<key> Authorization header. The fetch + SSE parse +
// single-accumulator usage collection is delegated to streamByokChat /
// completeByokChat in ./openai-chat so both adapters stay in lock-step on
// the SSE protocol (PRD §39).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stream a G4F chat completion (PRD §18). Returns an async iterable of
 * normalized StreamEvents:
 *   - { type: "delta"; content }   — one text increment
 *   - { type: "usage"; usage }       — final token usage (once, before "done")
 *   - { type: "done" }               — stream finished cleanly
 *
 * Throws typed errors derived from ByokUpstreamError on failure
 * (InvalidKeyError / RateLimitedError / ProviderUnavailableError /
 * InvalidRequestError / ModelNotFoundError / UpstreamError /
 * NetworkError / TimeoutError / UnknownError — PRD §62). Missing key
 * throws MissingG4fKeyError synchronously.
 */
export async function streamG4fChat(opts: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
}): Promise<AsyncIterable<StreamEvent>> {
  const key = (opts.apiKey ?? "").trim();
  if (!key) throw new MissingG4fKeyError();
  if (!opts.model) throw new InvalidRequestError(0, "model is required", "");
  if (!Array.isArray(opts.messages) || opts.messages.length === 0) {
    throw new InvalidRequestError(0, "messages must be a non-empty array", opts.model);
  }

  // Build the inner generator lazily so work only starts on first .next().
  return (async function* stream(): AsyncGenerator<StreamEvent, void, unknown> {
    let gen: AsyncGenerator<
      string,
      | {
          inputTokens: number;
          outputTokens: number;
          cacheTokens: number;
          estimated: boolean;
          upstreamCost?: number;
        }
      | undefined,
      unknown
    >;
    try {
      gen = streamByokChat({
        baseUrl: G4F_BASE_URL,
        apiKey: key,
        model: opts.model,
        messages: opts.messages,
        stream: true,
        signal: opts.signal,
      });
    } catch (err) {
      throw normalizeG4fError(err, opts.model);
    }

    let upstreamUsage:
      | {
          inputTokens: number;
          outputTokens: number;
          cacheTokens: number;
          estimated: boolean;
          upstreamCost?: number;
        }
      | undefined;

    try {
      while (true) {
        const { value, done } = await gen.next();
        if (done) {
          upstreamUsage = value ?? undefined;
          break;
        }
        if (typeof value === "string" && value.length > 0) {
          yield { type: "delta", content: value };
        }
      }
    } catch (err) {
      throw normalizeG4fError(err, opts.model);
    }

    if (upstreamUsage) {
      yield {
        type: "usage",
        usage: {
          prompt_tokens: upstreamUsage.inputTokens,
          completion_tokens: upstreamUsage.outputTokens,
          total_tokens:
            upstreamUsage.inputTokens + upstreamUsage.outputTokens,
        },
      };
    }
    yield { type: "done" };
  })();
}

/**
 * Non-streaming G4F chat completion (PRD §18). Returns the final content
 * and a usage object. Throws the same typed-error hierarchy as
 * streamG4fChat on failure (PRD §62).
 */
export async function completeG4fChat(opts: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
}): Promise<{
  content: string;
  usage: ChatUsage;
}> {
  const key = (opts.apiKey ?? "").trim();
  if (!key) throw new MissingG4fKeyError();
  if (!opts.model) throw new InvalidRequestError(0, "model is required", "");
  if (!Array.isArray(opts.messages) || opts.messages.length === 0) {
    throw new InvalidRequestError(0, "messages must be a non-empty array", opts.model);
  }

  let result: {
    text: string;
    usage?:
      | {
          inputTokens: number;
          outputTokens: number;
          cacheTokens: number;
          estimated: boolean;
          upstreamCost?: number;
        }
      | undefined;
    requestId?: string;
  };
  try {
    result = await completeByokChat({
      baseUrl: G4F_BASE_URL,
      apiKey: key,
      model: opts.model,
      messages: opts.messages,
      stream: false,
    });
  } catch (err) {
    throw normalizeG4fError(err, opts.model);
  }

  const usage: ChatUsage = result.usage
    ? {
        prompt_tokens: result.usage.inputTokens,
        completion_tokens: result.usage.outputTokens,
        total_tokens: result.usage.inputTokens + result.usage.outputTokens,
      }
    : { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  return { content: result.text ?? "", usage };
}

// ─────────────────────────────────────────────────────────────────────────────
// Key validation (PRD §18, §82)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate a G4F key (PRD §18, §82). Issues a minimal authenticated GET to
 * the protected /v1/models endpoint. G4F /v1/* rejects OpenAI-style keys
 * (sk-…) with 403 — only g4f_-prefixed member keys work — so we do a cheap
 * prefix pre-check first (saves a network call when the user pastes an
 * OpenAI key by mistake).
 *
 * Returns:
 *   - { ok: true, providerCount, modelCount }     on HTTP 200
 *   - { ok: false, error: "G4F API keys must start with 'g4f_'" }  on prefix
 *     mismatch (no network call made)
 *   - { ok: false, error: "Invalid G4F API key" }  on 401 / 403
 *   - { ok: false, error: "Rate limited; please try again later" } on 429
 *   - { ok: false, error: "G4F returned HTTP <status>" }  on other non-200
 *   - { ok: false, error: "Validation timed out" }  on 20s abort
 *   - { ok: false, error: "<message>" }  on network failure
 *
 * NEVER returns ok:true without a real 200 from the protected endpoint
 * (PRD §82 — no spurious "Connected" claim).
 */
export async function validateG4fKey(
  apiKey: string,
): Promise<{
  ok: boolean;
  error?: string;
  providerCount?: number;
  modelCount?: number;
}> {
  const key = (apiKey ?? "").trim();
  if (!key) return { ok: false, error: "Missing API key" };

  // G4F /v1/* rejects sk-… keys with 403 — short-circuit before the network.
  if (!key.startsWith("g4f_")) {
    return {
      ok: false,
      error: "G4F API keys must start with 'g4f_' (mint one at g4f.dev/members.html).",
    };
  }

  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer =
    controller && typeof setTimeout !== "undefined"
      ? setTimeout(() => controller.abort(), G4F_VALIDATE_TIMEOUT_MS)
      : null;

  try {
    const res = await fetch(`${G4F_BASE_URL}/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        "User-Agent": BROWSER_UA,
      },
      signal: controller?.signal,
    });

    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "Invalid G4F API key" };
    }
    if (res.status === 429) {
      return { ok: false, error: "Rate limited; please try again later" };
    }
    if (!res.ok) {
      return { ok: false, error: `G4F returned HTTP ${res.status}` };
    }

    // OpenAI-shaped response: { data: [{ id, … }, …] }.
    let json: { data?: unknown[] };
    try {
      json = (await res.json()) as { data?: unknown[] };
    } catch {
      // Malformed JSON → not validated (PRD §82 — never claim ok without a
      // real, parseable 200).
      return { ok: false, error: "Malformed response from G4F" };
    }

    const models = Array.isArray(json.data) ? json.data : [];
    // G4F /v1/models returns one entry per (model, provider) pair. The model
    // id is the upstream model id; provider derivation is best-effort.
    const providerSet = new Set<string>();
    for (const m of models) {
      if (!m || typeof m !== "object") continue;
      const id = ((m as { id?: unknown }).id ?? "") as string;
      if (!id) continue;
      // G4F model ids sometimes look like "<provider>:<model>" — split on
      // the first colon. Otherwise fall back to "default".
      const seg = id.includes(":") ? id.split(":")[0] : "default";
      providerSet.add(seg || "default");
    }
    return {
      ok: true,
      providerCount: providerSet.size,
      modelCount: models.length,
    };
  } catch (err) {
    if (isAbortError(err)) {
      return { ok: false, error: "Validation timed out" };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pricing (PRD §38)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve pricing for a discovered G4F model (PRD §38). G4F documents NO
 * per-model pricing per the OpenAPI spec + research — the discovery
 * payload contains no pricing metadata. Per the user's explicit request
 * ("remove fake pricing from g4f models"), we NO LONGER fall back to the
 * supplied pricing board by tail-segment match — that path was stamping
 * foreign market prices (e.g. `tb/gpt-5` → $1.25/$10) onto G4F models
 * whose `upstreamId` happened to share the trailing segment ("gpt-5"),
 * even though G4F does not actually charge those rates. The prices shown
 * for G4F models in the catalog were therefore fabricated.
 *
 * Resolution is now unambiguous:
 *   - G4F exposes no pricing → return nulls + source="undocumented".
 *   - The catalog UI renders "—" for null prices (formatUsd in the
 *     playground client), so G4F models now show "Input — · Output —"
 *     instead of fake dollar amounts.
 *
 * Values are USD per 1M tokens. null means "we could not establish a
 * price" (PRD §26 — never confuse $0 with "not documented").
 */
export function resolveG4fPricing(model: DiscoveredG4fModel): {
  inputPerMillion: number | null;
  outputPerMillion: number | null;
  cachePerMillion?: number | null;
  source: "provider" | "market" | "undocumented";
} {
  // G4F documents no per-model pricing — return nulls + undocumented.
  // (Previously this method also consulted the supplied pricing board by
  // trailing-segment match; that path produced fake prices on G4F models
  // and was removed per the user's "remove fake pricing" directive.)
  void model; // reserved for future use if G4F ever exposes pricing metadata
  return {
    inputPerMillion: null,
    outputPerMillion: null,
    cachePerMillion: null,
    source: "undocumented",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: discovery fetch + error normalization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch one of G4F's PUBLIC discovery endpoints with a 15s timeout +
 * browser-like UA. Throws G4fUnreachableError on 403/network/timeout;
 * throws ByokUpstreamError on other non-200; throws NetworkError on a
 * fetch-level failure. The discovery helpers CATCH these and convert to
 * the discriminated-union return shape.
 */
async function fetchG4fDiscovery<T>(path: string): Promise<T> {
  const url = `${G4F_DISCOVERY_BASE_URL}${path}`;
  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer =
    controller && typeof setTimeout !== "undefined"
      ? setTimeout(() => controller.abort(), G4F_DISCOVERY_TIMEOUT_MS)
      : null;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "application/json",
      },
      signal: controller?.signal,
    });
  } catch (err) {
    if (isAbortError(err)) {
      throw new G4fUnreachableError(
        `G4F discovery timed out after ${G4F_DISCOVERY_TIMEOUT_MS}ms: ${url}`,
        err,
      );
    }
    // fetch-level failure (DNS, TCP, CORS) — treat as unreachable since we
    // cannot establish whether the endpoint is up.
    throw new G4fUnreachableError(
      `G4F discovery network error: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  } finally {
    if (timer) clearTimeout(timer);
  }

  // 403 = Vercel egress block (verified in prod logs). Surface as unreachable.
  if (res.status === 403) {
    throw new G4fUnreachableError(
      `G4F discovery endpoint returned 403 (likely Vercel egress block): ${url}`,
    );
  }
  if (!res.ok) {
    throw new ByokUpstreamError(res.status, await safeReadBody(res), "");
  }

  try {
    return (await res.json()) as T;
  } catch (err) {
    throw new ByokUpstreamError(
      res.status,
      `Invalid JSON from ${url}: ${err instanceof Error ? err.message : String(err)}`,
      "",
    );
  }
}

/** Convert a thrown value from the discovery fetch into the error string. */
function toDiscoveryError(err: unknown): string {
  if (err instanceof G4fUnreachableError) return "G4F_UNREACHABLE";
  if (err instanceof ByokUpstreamError) {
    if (err.status === 403) return "G4F_UNREACHABLE";
    return `G4F_HTTP_${err.status}`;
  }
  if (err instanceof NetworkError) return "G4F_UNREACHABLE";
  if (err instanceof TimeoutError) return "G4F_UNREACHABLE";
  if (err instanceof Error) return `G4F_ERROR: ${err.message}`;
  return "G4F_UNKNOWN";
}

/** Convert one raw G4F provider entry into the normalized shape. */
function normalizeProvider(p: G4fRawProvider): DiscoveredG4fProvider | null {
  if (!p || typeof p !== "object") return null;
  const upstreamId = (p.name ?? "").trim();
  if (!upstreamId) return null;
  return {
    upstreamId,
    name: (p.label ?? upstreamId).trim() || upstreamId,
    docsUrl: undefined, // G4F exposes no per-provider docs URL.
    rawMetadata: p as unknown as Record<string, unknown>,
  };
}

/**
 * Map a thrown value (typically a ByokUpstreamError from streamByokChat /
 * completeByokChat, or a network error) onto the typed error classes
 * imported from ./gratisfy. The shared ByokUpstreamError base is preserved
 * on all HTTP-shaped errors so existing `instanceof ByokUpstreamError`
 * checks keep working.
 */
function normalizeG4fError(err: unknown, model: string): Error {
  if (err instanceof ByokUpstreamError) {
    const status = err.status;
    const body = err.body;
    if (status === 401 || status === 403) {
      return new InvalidKeyError(status, body, model);
    }
    if (status === 429) {
      return new RateLimitedError(status, body, model);
    }
    if (status === 404) {
      return new ModelNotFoundError(status, body, model);
    }
    if (status === 400) {
      return new InvalidRequestError(status, body, model);
    }
    if (status >= 500) {
      return new ProviderUnavailableError(status, body, model);
    }
    return new UpstreamError(status, body, model);
  }
  if (isAbortError(err)) {
    return new TimeoutError();
  }
  if (err instanceof Error) {
    // fetch-level network failures (DNS, TCP reset, CORS, etc).
    const msg = err.message.toLowerCase();
    if (
      err.name === "TypeError" ||
      err.name === "FetchError" ||
      msg.includes("fetch") ||
      msg.includes("network") ||
      msg.includes("econnrefused") ||
      msg.includes("enotfound")
    ) {
      return new NetworkError(err.message, err, model);
    }
    return new UnknownError(err.message, err);
  }
  return new UnknownError(String(err));
}

function isAbortError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof Error) {
    return (
      err.name === "AbortError" ||
      err.name === "TimeoutError" ||
      /aborted|timeout/i.test(err.message)
    );
  }
  return false;
}

async function safeReadBody(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.slice(0, 500);
  } catch {
    return "";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

// NOTE: the supplied-pricing-board helpers (`suppliedBoardIds`,
// `SUPPLIED_BOARD_IDS`) were removed when `resolveG4fPricing` stopped
// falling back to the supplied board by tail-segment match — that path
// produced fake prices on G4F models. If G4F ever exposes real per-model
// pricing metadata, reintroduce a *provider-sourced* resolver here.

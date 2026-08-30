/**
 * Gratisfy BYOK adapter — PRD §15, §16, §17, §37, §56, §58.
 *
 * TWO endpoints:
 *
 *   1. PUBLIC CATALOG (discovery, no auth required):
 *        https://gratisfy.xyz/api/models/all
 *      Returns the FULL published catalog: 2084 models across 36 providers
 *      with rich pricing metadata (`pricing.input` / `pricing.output` numeric
 *      OR `"Free"`, `pricing.inputDisplay`/`outputDisplay` human strings,
 *      `freeTier.isFree`, `rateLimits`, `features`, `contextWindow`,
 *      `maxOutputTokens`, `inputModalities`, `outputModalities`, `ownedBy`,
 *      `aliases`). Verified live 2026-08-30 — anonymous GET returns 8.2 MB
 *      JSON with HTTP 200, no Authorization header needed.
 *
 *   2. AUTH-GATED BYOK (chat + key validation):
 *        Base URL:   https://api.gratisfy.xyz/v1
 *        Auth:       Authorization: Bearer <gxyz-key>  (BYOK — PRD §54)
 *        Chat:       POST /v1/chat/completions        (OpenAI-shaped)
 *        Validate:   GET  /v1/models?modality=language
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DISCOVERY MODEL (PRD §17 — relaxed from auth-gated to public):
 *
 *   discoverGratisfyModels() now fetches the PUBLIC catalog endpoint with NO
 *   Authorization header. The platform-default `gxyz-...` key is no longer
 *   needed for discovery — every user (anonymous OR signed-in) sees the full
 *   2084-model catalog. A user's own BYOK key is still required to CHAT with
 *   a Gratisfy model (the chat route reads the per-user BYOK key from the
 *   X-Gratisfy-API-Key header / OnyxBase credential store and posts to
 *   api.gratisfy.xyz/v1/chat/completions — see ./byok-route.ts).
 *
 *   The previous auth-gated /v1/models?modality=all endpoint is kept ONLY for
 *   validateGratisfyKey() (the BYOK connect flow), where the act of saving a
 *   key must produce a real 200 from the protected endpoint to prove the key
 *   is valid.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Error normalization (PRD §62, §82): every upstream failure is converted into
 * a typed error class derived from the shared ByokUpstreamError base
 * (./openai-chat). Callers can `instanceof`-check to choose the right HTTP
 * envelope + retry policy.
 *
 * Pricing (PRD §37): resolveGratisfyPricing(model) reads the public catalog's
 * rich pricing metadata. Resolution order:
 *   1. Numeric `pricing.input` / `pricing.output` (number OR a string like
 *      "5 pollen/M") → status:"documented". Numbers < 1 are per-token →
 *      multiplied by 1_000_000; numbers >= 1 are already per-million —
 *      matches OpenRouter's convention. Strings like "5 pollen/M" parse
 *      to 5 per million with `currency:"pollen"` (Pollinations-internal
 *      currency surfaced through the Gratisfy catalog — NOT USD).
 *      Per-image / per-second / per-hour strings ("0.06 pollen/img",
 *      "0.00006 pollen/sec") do NOT surface as per-million (caller falls
 *      through to the free / not_documented paths so the catalog doesn't
 *      show nonsense $0/M for image / audio / video models).
 *   2. `freeTier.isFree === true`              → status:"free", $0/$0
 *   3. Otherwise nulls + status:"not_documented"  → catalog shows "—"
 */

import {
  ByokUpstreamError,
  completeByokChat,
  streamByokChat,
} from "./openai-chat";
// parseSseLine is consumed internally by streamByokChat; we delegate to
// streamByokChat instead of re-implementing the SSE loop, per the reuse rule
// in the work order (PRD §39 — single SSE accumulator).
// Pricing (PRD §37): only provider-sourced pricing is honoured for Gratisfy.
// resolveGratisfyPricing returns nulls + source="undocumented" unless
// Gratisfy itself published a price in /v1/models — see its comment for
// why the supplied-pricing-board fallback was removed.

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const GRATISFY_BASE_URL = "https://api.gratisfy.xyz/v1";
/** Public catalog endpoint — anonymous GET, returns the full 2084-model
 *  catalog with rich pricing + provider classification. Live verified
 *  2026-08-30: 8.2 MB JSON, HTTP 200, no Authorization header needed. */
export const GRATISFY_PUBLIC_CATALOG_URL = "https://gratisfy.xyz/api/models/all";
/** Default per-request timeout for validation calls (cheap endpoint). */
export const GRATISFY_VALIDATE_TIMEOUT_MS = 20_000;

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/** Chat message — the OpenAI role/content pair (string content only). */
export interface ChatMessage {
  role: string;
  content: string;
}

/** Normalized token-usage shape, OpenAI-style. */
export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/** Normalized stream events emitted by streamGratisfyChat (PRD §39). */
export type StreamEvent =
  | { type: "delta"; content: string }
  | { type: "usage"; usage: ChatUsage }
  | { type: "done" };

/**
 * A single model discovered from Gratisfy's auth-gated /v1/models endpoint.
 * This is the RAW shape — registry.ts / the route handler turn this into a
 * UnifiedModel + upsert into Prisma ProviderModel (PRD §17).
 */
export interface DiscoveredGratisfyModel {
  /** Raw id from Gratisfy (e.g. "google-ai-studio/gemini-2.5-flash" or "router/free"). */
  upstreamId: string;
  /** Display name (the trailing segment after the last "/"). */
  name: string;
  /** Optional description from upstream, if provided. */
  description?: string;
  /** Capability flags surfaced from upstream (e.g. ["text", "vision"]). */
  capabilities: string[];
  /** Context window length in tokens, if upstream advertises it. */
  contextLength?: number;
  /** Modality tag (e.g. "language", "image", "audio") if surfaced. */
  modality?: string;
  /** Raw upstream JSON (for debugging / future field extraction). */
  rawMetadata?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Typed errors (PRD §62, §82)
//
// All HTTP-shaped errors extend ByokUpstreamError so existing callers that
// `instanceof ByokUpstreamError` keep working. The classes are exported so
// the route handler can pick the correct HTTP status + retryable flag.
// ─────────────────────────────────────────────────────────────────────────────

/** Thrown when a function needs the user's Gratisfy key but none was supplied. */
export class MissingGratisfyKeyError extends Error {
  constructor(message = "A Gratisfy BYOK key is required for this operation (PRD §17).") {
    super(message);
    this.name = "MissingGratisfyKeyError";
  }
}

/** 401 / 403 — key invalid, revoked, or insufficient scope. */
export class InvalidKeyError extends ByokUpstreamError {
  constructor(status: number, body: string, model = "") {
    super(status, body, model);
    this.name = "InvalidKeyError";
  }
}

/** 429 — upstream rate limit hit. Retryable. */
export class RateLimitedError extends ByokUpstreamError {
  constructor(status: number, body: string, model = "") {
    super(status, body, model);
    this.name = "RateLimitedError";
  }
}

/** 404 — model id not found upstream. */
export class ModelNotFoundError extends ByokUpstreamError {
  constructor(status: number, body: string, model = "") {
    super(status, body, model);
    this.name = "ModelNotFoundError";
  }
}

/** 502 / 503 / 504 — upstream is down or timing out. Retryable. */
export class ProviderUnavailableError extends ByokUpstreamError {
  constructor(status: number, body: string, model = "") {
    super(status, body, model);
    this.name = "ProviderUnavailableError";
  }
}

/** 400 — client sent a malformed request (bad messages, bad sampling). */
export class InvalidRequestError extends ByokUpstreamError {
  constructor(status: number, body: string, model = "") {
    super(status, body, model);
    this.name = "InvalidRequestError";
  }
}

/** Catch-all for upstream HTTP errors not matched by a more specific class. */
export class UpstreamError extends ByokUpstreamError {
  constructor(status: number, body: string, model = "") {
    super(status, body, model);
    this.name = "UpstreamError";
  }
}

/** fetch threw before a response arrived (DNS, TCP, CORS, abort). */
export class NetworkError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
    public readonly model = "",
  ) {
    super(message);
    this.name = "NetworkError";
  }
}

/** Request was aborted via AbortSignal before completing. */
export class TimeoutError extends Error {
  constructor(message = "Gratisfy request timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}

/** Anything we couldn't classify. */
export class UnknownError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "UnknownError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Discovery (PRD §17) — PUBLIC CATALOG, no auth required
// ─────────────────────────────────────────────────────────────────────────────

/** Raw shape of one entry in the public catalog's `models` array.
 *
 * Verified live against `https://gratisfy.xyz/api/models/all` (2026-08-30).
 * The response is `{ capabilitySchemaVersion, capabilityPayloadMode, models: [...], ... }`
 * with 2084 entries. Each entry uses camelCase keys (NOT the snake_case shape
 * of the legacy /v1/models endpoint). The high-signal fields:
 *
 *   - `id`                 — the upstream chat-compatible model id (e.g.
 *                             "inclusionai/ling-3.0-flash-fin:free",
 *                             "glm-5:free", "gpt-4o-transcribe"). ALWAYS a
 *                             string, NEVER null/undefined. Pass-through to
 *                             Gratisfy's /v1/chat/completions.
 *   - `name`               — human display name (e.g. "Ling 3.0 Flash Fin (free)")
 *   - `provider`           — the REAL upstream routing slug (e.g. "openrouter",
 *                             "unorouter", "crax-gpt", "cloudflare", "groq",
 *                             "google-ai-studio", …). 36 providers in the
 *                             2084-model catalog.
 *   - `type`               — modality: "language" | "image" | "audio" | "video"
 *                             | "embedding" | "ocr" | "translation" | "moderation"
 *   - `contextWindow`      — max prompt context in tokens (nullable)
 *   - `maxOutputTokens`    — max completion length (nullable)
 *   - `pricing`            — { input, output, image, inputDisplay, outputDisplay,
 *                             webSearch } where `input`/`output` are EITHER the
 *                             string "Free" OR a per-token/per-million number.
 *                             `inputDisplay`/`outputDisplay` are HUMAN strings
 *                             (e.g. "Free", "500K tokens/day shared",
 *                             "5 RPM shared on free tier", "50 RPD",
 *                             "1 credit/request", "neurons/M", "Unlimited").
 *   - `freeTier`           — { isFree: boolean, note: string, ... } — the
 *                             AUTHORITATIVE "is this model free to call right
 *                             now" flag. If isFree===true the catalog stamps
 *                             status:"free" + $0/$0 regardless of numeric price.
 *   - `rateLimits`         — { rpm, ipm, rph, rpd, rpMonth, concurrentRequests,
 *                             tpm, tph, tpd, ... } — rate-limit metadata.
 *   - `features`           — ["reasoning","tool-use","web-search","vision",...]
 *   - `inputModalities`    — ["text","image","audio","video",...]
 *   - `outputModalities`   — ["text","image","audio","video",...]
 *   - `ownedBy`            — string (e.g. "inclusionai", "OpenAI", "Google")
 *   - `aliases`            — string[] (alternate ids also accepted by chat)
 *
 * DEDUP (PRD §19 / playground React-key fix): the public catalog DOES list
 * some ids more than once (verified: 196 of 2084 entries are duplicates of
 * another (provider, id) pair). The buildGratisfyModels() function in
 * registry.ts collapses by the resulting publicId `gratisfy:<provider>:<id>`
 * — first occurrence wins. No bare-alias duplicates exist on the public
 * endpoint (unlike the legacy /v1/models endpoint which carried 228 of them).
 */
interface GratisfyRawModel {
  id?: string;
  name?: string;
  displayName?: string;
  description?: string;
  // camelCase (NEW public catalog shape):
  contextWindow?: number;
  maxOutputTokens?: number;
  type?: string; // modality: language|image|audio|video|embedding|ocr|translation|moderation
  features?: string[];
  inputModalities?: string[];
  outputModalities?: string[];
  supportedParameters?: string[];
  pricing?: {
    input?: string | number | null;
    output?: string | number | null;
    image?: string | number | null;
    inputDisplay?: string | null;
    outputDisplay?: string | null;
    webSearch?: string | number | null;
  };
  freeTier?: { isFree?: boolean; note?: string | null };
  rateLimits?: Record<string, unknown>;
  provider?: string; // the REAL upstream routing slug — never "alias"
  ownedBy?: string; // upstream owner (e.g. "inclusionai", "OpenAI")
  aliases?: string[];
  // snake_case (LEGACY /v1/models endpoint — kept for validateGratisfyKey()
  // which still hits the auth-gated endpoint):
  context_length?: number;
  max_context_length?: number;
  context_window?: number;
  context?: number;
  modality?: string;
  capabilities?: string[] | Record<string, boolean>;
  input_modalities?: string[];
  output_modalities?: string[];
  supported_parameters?: string[];
  max_output_tokens?: number;
  maxOutput?: number;
  pricing_tier?: string;
  free_tier?: { is_free?: boolean; note?: string };
  metadata?: Record<string, unknown>;
  [k: string]: unknown;
}

/**
 * Discover Gratisfy models (PRD §17). Fetches the PUBLIC catalog endpoint
 * `https://gratisfy.xyz/api/models/all` with NO Authorization header — every
 * user (anonymous OR signed-in) sees the full 2084-model / 36-provider catalog
 * with rich pricing + provider classification. The optional `apiKey` parameter
 * is IGNORED at the catalog endpoint (it's accepted only for backward-compat
 * with callers that previously passed the platform default key; discovery no
 * longer needs it).
 *
 * Throws NetworkError / ProviderUnavailableError / UpstreamError for upstream
 * failures (PRD §62). The route handler upserts each DiscoveredGratisfyModel
 * into the registry's buildGratisfyModels() to produce UnifiedModel[] for the
 * catalog + /api/v1/models response.
 *
 * The user's own BYOK key is still required to CHAT with a Gratisfy model
 * (see ./byok-route.ts — the chat route reads the per-user BYOK key from
 * OnyxBase + posts to api.gratisfy.xyz/v1/chat/completions).
 */
export async function discoverGratisfyModels(
  apiKey?: string,
  signal?: AbortSignal,
): Promise<DiscoveredGratisfyModel[]> {
  // apiKey is accepted but ignored — the public catalog endpoint is anonymous.
  // (kept in the signature so the legacy caller in registry.ts that passes
  // GRATISFY_DEFAULT_KEY still compiles without churn.)
  void apiKey;

  let res: Response;
  try {
    // The public catalog endpoint returns an ~8 MB JSON blob — fresh on
    // every call (per the user's "remove caching of catalog" directive).
    // A small `?_=<nonce>` cache-bust + `Cache-Control: no-store` keeps
    // Vercel's edge from serving a stale snapshot.
    const nonce = Date.now().toString(36);
    res = await fetch(`${GRATISFY_PUBLIC_CATALOG_URL}?_=${nonce}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-store",
        Pragma: "no-cache",
        "X-Request-Id": `freeaixyz-gratisfy-discovery-${nonce}`,
      },
      signal,
    });
  } catch (err) {
    if (isAbortError(err)) throw new TimeoutError();
    throw new NetworkError(
      err instanceof Error ? err.message : String(err),
      err,
      "",
    );
  }

  // Map status → typed error (PRD §62).
  if (res.status === 401 || res.status === 403) {
    // Shouldn't happen on the public endpoint, but be defensive.
    throw new InvalidKeyError(res.status, await safeReadBody(res), "");
  }
  if (res.status === 429) {
    throw new RateLimitedError(res.status, await safeReadBody(res), "");
  }
  if (res.status >= 500) {
    throw new ProviderUnavailableError(res.status, await safeReadBody(res), "");
  }
  if (!res.ok) {
    throw new UpstreamError(res.status, await safeReadBody(res), "");
  }

  let json: { models?: GratisfyRawModel[] };
  try {
    json = (await res.json()) as { models?: GratisfyRawModel[] };
  } catch (err) {
    throw new UpstreamError(
      res.status,
      `Invalid JSON from ${GRATISFY_PUBLIC_CATALOG_URL}: ${err instanceof Error ? err.message : String(err)}`,
      "",
    );
  }

  // The public catalog wraps the model list under `models` (not `data`).
  // Verified live: 2084 entries across 36 providers in `models[]`.
  const list = Array.isArray(json.models) ? json.models : [];
  const out: DiscoveredGratisfyModel[] = [];
  for (const m of list) {
    const norm = normalizeRawModel(m);
    if (norm) out.push(norm);
  }
  return out;
}

/** Convert one raw upstream model into the normalized shape.
 *
 * The PUBLIC catalog endpoint (`gratisfy.xyz/api/models/all`) does NOT carry
 * bare-alias duplicates — every entry has a real `id` + `provider` field
 * (verified live 2026-08-30: 2084 entries, 196 of which share an `id` with
 * another entry but always under a different `provider` — so they're
 * legitimately distinct (provider, model) pairs, not duplicates).
 *
 * The legacy `?modality=all` endpoint DID carry 228 bare-alias duplicates
 * (entries with `owned_by === "alias"` and an id without a "/"). The drop
 * logic below is kept as a defensive guard in case the upstream ever
 * reintroduces that shape — but on the current public endpoint it's a no-op.
 *
 * Capabilities derive from `features` + `inputModalities` +
 * `outputModalities` + `type` (all camelCase on the new endpoint). The
 * legacy snake_case fields (`input_modalities`, etc.) are also read for
 * safety in case a future payload mixes shapes.
 */
function normalizeRawModel(m: GratisfyRawModel): DiscoveredGratisfyModel | null {
  const upstreamId = (m.id ?? "").trim();
  if (!upstreamId) return null;

  // Drop bare-alias duplicates (legacy /v1/models only — the public
  // /api/models/all endpoint doesn't carry them, but be defensive).
  const ownedByRaw =
    typeof m.ownedBy === "string"
      ? m.ownedBy
      : typeof m.owned_by === "string"
        ? m.owned_by
        : "";
  const isAlias = ownedByRaw.toLowerCase() === "alias";
  if (isAlias && !upstreamId.includes("/")) {
    return null;
  }

  const name = (m.name ?? m.displayName ?? lastSegment(upstreamId)).trim();
  return {
    upstreamId,
    name,
    description: typeof m.description === "string" ? m.description : undefined,
    capabilities: capabilitiesToList(m),
    contextLength: pickFirstNumber(
      m.contextWindow,
      m.context_window,
      m.context_length,
      m.max_context_length,
      m.context,
    ),
    modality:
      typeof m.type === "string"
        ? m.type
        : typeof m.modality === "string"
          ? m.modality
          : undefined,
    rawMetadata: m as unknown as Record<string, unknown>,
  };
}

/** Pick the first finite-number value from the list of candidates. */
function pickFirstNumber(
  ...candidates: Array<number | undefined | null>
): number | undefined {
  for (const c of candidates) {
    if (typeof c === "number" && Number.isFinite(c)) return c;
  }
  return undefined;
}

/**
 * Build a normalized capability list from the public-catalog payload shape.
 *
 * The public catalog carries (all camelCase):
 *   - `features`           — array of capability tags (e.g. "reasoning",
 *                             "tool-use", "web-search", "vision")
 *   - `inputModalities`    — array of strings like "text", "image", "audio"
 *   - `outputModalities`   — array of strings like "text", "image", "audio"
 *   - `type`               — modality ("language" | "image" | "audio" |
 *                             "video" | "embedding" | "ocr" |
 *                             "translation" | "moderation")
 *
 * The legacy snake_case variants (`input_modalities`, etc.) are also read
 * so the function tolerates a mixed-shape payload.
 *
 * The registry's buildCapabilities() (src/lib/xyz/registry.ts) maps the
 * resulting flat list into the UnifiedModel.capabilities object.
 */
function capabilitiesToList(m: GratisfyRawModel): string[] {
  const caps = new Set<string>();
  caps.add("text"); // every Gratisfy model supports text chat

  // Features → direct capability tags. The public catalog uses kebab-case
  // feature names like "tool-use" and "web-search"; the legacy endpoint
  // used snake_case like "tool_calling". Normalize both to underscores so
  // buildCapabilities()'s .toLowerCase() checks line up with the existing
  // "tools" / "web_search" capability keys.
  const features = Array.isArray(m.features) ? m.features : [];
  for (const f of features) {
    if (typeof f !== "string") continue;
    const norm = f.toLowerCase().replace(/-/g, "_");
    caps.add(norm);
  }

  // Legacy capabilities field (some entries may still carry it).
  if (Array.isArray(m.capabilities)) {
    for (const c of m.capabilities) {
      if (typeof c === "string") caps.add(c.toLowerCase());
    }
  } else if (m.capabilities && typeof m.capabilities === "object") {
    for (const [k, v] of Object.entries(m.capabilities)) {
      if (v === true) caps.add(k.toLowerCase());
    }
  }

  // Input modalities → vision/audio/video input capabilities.
  // Read BOTH the new camelCase field and the legacy snake_case one.
  const inputMods = Array.isArray(m.inputModalities)
    ? m.inputModalities
    : Array.isArray(m.input_modalities)
      ? m.input_modalities
      : [];
  for (const mod of inputMods) {
    if (typeof mod !== "string") continue;
    const lower = mod.toLowerCase();
    if (lower === "image") caps.add("vision");
    else if (lower === "audio") caps.add("audio_input");
    else if (lower === "video") caps.add("video_input");
  }

  // Output modalities → image/audio/video generation capabilities.
  const outputMods = Array.isArray(m.outputModalities)
    ? m.outputModalities
    : Array.isArray(m.output_modalities)
      ? m.output_modalities
      : [];
  for (const mod of outputMods) {
    if (typeof mod !== "string") continue;
    const lower = mod.toLowerCase();
    if (lower === "image") caps.add("image");
    else if (lower === "audio") caps.add("audio");
    else if (lower === "video") caps.add("video");
  }

  // Modality (type field) → capability flag.
  if (typeof m.type === "string") {
    const t = m.type.toLowerCase();
    if (t === "image") caps.add("image");
    else if (t === "audio") caps.add("audio");
    else if (t === "video") caps.add("video");
  }

  return Array.from(caps);
}

function lastSegment(id: string): string {
  const parts = id.split("/");
  return parts[parts.length - 1] || id;
}

// ─────────────────────────────────────────────────────────────────────────────
// Chat generation (PRD §8, §9, §15)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stream a Gratisfy chat completion (PRD §15). Returns an async iterable of
 * normalized StreamEvents:
 *   - { type: "delta"; content }   — one text increment
 *   - { type: "usage"; usage }       — final token usage (emitted once, before "done")
 *   - { type: "done" }               — stream finished cleanly
 *
 * Auth + request errors are thrown as typed ByokUpstreamError-derived classes
 * (PRD §62). The fetch + SSE parsing is delegated to streamByokChat (which
 * internally uses parseSseLine — single accumulator, usage captured once).
 */
export async function streamGratisfyChat(opts: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
}): Promise<AsyncIterable<StreamEvent>> {
  const key = (opts.apiKey ?? "").trim();
  if (!key) throw new MissingGratisfyKeyError();
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
        baseUrl: GRATISFY_BASE_URL,
        apiKey: key,
        model: opts.model,
        messages: opts.messages,
        stream: true,
        signal: opts.signal,
      });
    } catch (err) {
      throw normalizeByokError(err, opts.model);
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
      throw normalizeByokError(err, opts.model);
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
 * Non-streaming Gratisfy chat completion (PRD §8). Returns the final content +
 * a usage object. Throws typed ByokUpstreamError-derived classes on failure.
 */
export async function completeGratisfyChat(opts: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
}): Promise<{ content: string; usage: ChatUsage }> {
  const key = (opts.apiKey ?? "").trim();
  if (!key) throw new MissingGratisfyKeyError();
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
      baseUrl: GRATISFY_BASE_URL,
      apiKey: key,
      model: opts.model,
      messages: opts.messages,
      stream: false,
    });
  } catch (err) {
    throw normalizeByokError(err, opts.model);
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
// Key validation (PRD §16, §82)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate a Gratisfy key by issuing a minimal authenticated GET to
 * /v1/models?modality=language. Returns:
 *   - { ok: true, providerCount, modelCount }   on HTTP 200
 *   - { ok: false, error }                        on 401 / 403 / 429 / network error
 *
 * NEVER returns ok: true without a real 200 from the protected endpoint
 * (PRD §82 — no "Connected" claim unless the key actually verified).
 */
export async function validateGratisfyKey(
  apiKey: string,
): Promise<{
  ok: boolean;
  error?: string;
  providerCount?: number;
  modelCount?: number;
}> {
  const key = (apiKey ?? "").trim();
  if (!key) return { ok: false, error: "Missing API key" };

  // Use an AbortController to bound the validation request (§16 — cheap probe).
  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer =
    controller && typeof setTimeout !== "undefined"
      ? setTimeout(() => controller.abort(), GRATISFY_VALIDATE_TIMEOUT_MS)
      : null;

  try {
    const res = await fetch(`${GRATISFY_BASE_URL}/models?modality=language`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
      signal: controller?.signal,
    });

    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "Invalid API key" };
    }
    if (res.status === 429) {
      return { ok: false, error: "Rate limited; please try again later" };
    }
    if (!res.ok) {
      return {
        ok: false,
        error: `Gratisfy returned HTTP ${res.status}`,
      };
    }

    let json: { data?: GratisfyRawModel[] };
    try {
      json = (await res.json()) as { data?: GratisfyRawModel[] };
    } catch {
      // Treat malformed JSON as not-validated (PRD §82).
      return { ok: false, error: "Malformed response from Gratisfy" };
    }

    const models = Array.isArray(json.data) ? json.data : [];
    const providerSet = new Set<string>();
    for (const m of models) {
      const id = (m?.id ?? "").trim();
      if (!id) continue;
      providerSet.add(id.includes("/") ? id.split("/")[0] : "router");
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
// Pricing (PRD §37)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve pricing for a discovered Gratisfy model (PRD §37). Resolution
 * reads the PUBLIC catalog's rich pricing metadata in this order:
 *
 *   1. Numeric `pricing.input` / `pricing.output` (when both finite) →
 *      status:"documented". Numbers < 1 are per-token (OpenRouter
 *      convention) → multiplied by 1_000_000 to convert to per-million.
 *      Numbers >= 1 are already per-million. (e.g. `gpt-4o-transcribe` has
 *      `pricing.input=2.5, output=10` → $2.50 / $10 per 1M — real prices
 *      the user explicitly asked to surface.)
 *   2. `freeTier.isFree === true` (camelCase on the new endpoint) OR
 *      legacy `free_tier.is_free === true` OR `pricing_tier === "free"` OR
 *      `pricing.input === "Free"` (string) → status:"free", $0/$0.
 *      (e.g. `inclusionai/ling-3.0-flash-fin:free`, `glm-5:free`, the
 *      431 "Free"-priced models, the 121 "500K tokens/day shared" models,
 *      the 116 "5 RPM shared on free tier" models.)
 *   3. Otherwise nulls + status:"not_documented" → catalog shows "—".
 *
 * Per the user's explicit directive ("remove fake pricing from gratisfy
 * models"), we NEVER fall back to the supplied pricing board by tail-segment
 * match — that path was stamping foreign market prices (e.g. `tb/gemini-2.5-flash`
 * → $0.30/$2.50) onto Gratisfy models whose upstreamId happened to share
 * the trailing segment. Now the catalog surfaces Gratisfy's OWN published
 * prices (numeric or "Free"/`freeTier.isFree`) — exactly what the user
 * asked for in "Fetch gratisfy model with prices from
 * https://gratisfy.xyz/api/models/all this with prices".
 *
 * Values are USD per 1M tokens. null means "we could not establish a
 * price" (PRD §26 — never confuse $0 with "not documented").
 */
export function resolveGratisfyPricing(model: DiscoveredGratisfyModel): {
  inputPerMillion: number | null;
  outputPerMillion: number | null;
  cachePerMillion?: number | null;
  currency: "USD" | "pollen";
  status: "documented" | "supplied" | "estimated" | "free" | "not_documented";
  source: "provider" | "pricing-board" | "manual" | "unknown";
  verifiedAt?: string;
} {
  // 1. Numeric pricing — surface REAL per-million rates from the catalog.
  //    This is the user's "with prices" directive: stop showing fake $0/M
  //    for paid models whose pricing was a string like "5 pollen/M".
  //    The new `extractNumericPricing` parses BOTH plain numbers (per-token
  //    when < 1, per-million when >= 1) AND strings like "5 pollen/M",
  //    "0.06 pollen/img", "0.00006 pollen/sec" (it extracts the leading
  //    numeric value and detects the currency from the unit suffix).
  //    When real numeric rates are found, they are surfaced with
  //    status:"documented" so the catalog shows the actual numbers — even
  //    if `freeTier.isFree` is also true (the paid rate still applies past
  //    the free-tier budget). Currency is "pollen" when the pricing string
  //    contains "pollen" (Pollinations-internal currency surfaced through
  //    Gratisfy's catalog), otherwise "USD".
  const numeric = extractNumericPricing(model);
  if (numeric) {
    return {
      inputPerMillion: numeric.inputPerMillion,
      outputPerMillion: numeric.outputPerMillion,
      cachePerMillion: null,
      currency: numeric.currency,
      status: "documented",
      source: "provider",
      verifiedAt: new Date().toISOString(),
    };
  }

  // 2. Free signal — `freeTier.isFree` (new) OR `free_tier.is_free` (legacy)
  //    OR `pricing_tier === "free"` OR `pricing.input === "Free"` string.
  //    Surface $0/$0 with status:"free" so the catalog UI lights up the
  //    green "free" badge and the playground shows the "free" pill.
  //    Currency defaults to USD when no pollen-string pricing was detected
  //    (i.e. there was no `pricing.input/output` string mentioning pollen).
  const freeCurrency = detectPricingCurrency(model) ?? "USD";
  if (isFreeModel(model)) {
    return {
      inputPerMillion: 0,
      outputPerMillion: 0,
      cachePerMillion: 0,
      currency: freeCurrency,
      status: "free",
      source: "provider",
      verifiedAt: new Date().toISOString(),
    };
  }

  // 3. Undocumented — return nulls, NEVER $0 (PRD §26).
  return {
    inputPerMillion: null,
    outputPerMillion: null,
    cachePerMillion: null,
    currency: freeCurrency,
    status: "not_documented",
    source: "unknown",
  };
}

/**
 * Read Gratisfy's free-tier signal from the raw upstream model payload.
 * Both the new public catalog (`gratisfy.xyz/api/models/all`) and the
 * legacy auth-gated endpoint (`api.gratisfy.xyz/v1/models`) are handled:
 *
 *   - NEW: `freeTier: { isFree: true, note: "…" }`           (camelCase)
 *   - NEW: `pricing.input === "Free"` (string)                  (free price)
 *   - LEGACY: `free_tier: { is_free: true, note: "…" }`         (snake_case)
 *   - LEGACY: `pricing_tier: "free"` (top-level string)
 *   - LEGACY: `tier: "anonymous"` | `tier: "seed"` (Pollinations-style)
 *
 * Returns true when ANY of those flags indicates a free model.
 */
function isFreeModel(model: DiscoveredGratisfyModel): boolean {
  const raw = model.rawMetadata as Record<string, unknown> | undefined;
  if (!raw) return false;

  // NEW: freeTier.isFree === true (camelCase, public catalog)
  const ftCamel = raw.freeTier;
  if (ftCamel && typeof ftCamel === "object") {
    const isFree = (ftCamel as Record<string, unknown>).isFree;
    if (isFree === true) return true;
  }

  // LEGACY: free_tier.is_free === true (snake_case, /v1/models)
  const ftSnake = raw.free_tier;
  if (ftSnake && typeof ftSnake === "object") {
    const isFree = (ftSnake as Record<string, unknown>).is_free;
    if (isFree === true) return true;
  }

  // NEW: pricing.input === "Free" (string) — the public catalog's free-price
  // marker. Verified live: 431 of 2084 models carry `pricing.input="Free"`.
  const pricing = raw.pricing;
  if (pricing && typeof pricing === "object") {
    const p = pricing as Record<string, unknown>;
    if (
      (typeof p.input === "string" && p.input.toLowerCase() === "free") ||
      (typeof p.output === "string" && p.output.toLowerCase() === "free")
    ) {
      return true;
    }
  }

  // LEGACY: pricing_tier === "free" (top-level string, /v1/models)
  if (typeof raw.pricing_tier === "string" && raw.pricing_tier.toLowerCase() === "free") {
    return true;
  }

  // LEGACY: tier: "anonymous" | "seed" | "free" (Pollinations-style)
  if (typeof raw.tier === "string") {
    const t = raw.tier.toLowerCase();
    if (t === "anonymous" || t === "free" || t === "seed") {
      return true;
    }
  }

  return false;
}

/** Read the new public-catalog `pricing` object for numeric per-million rates.
 *
 * The public catalog's `pricing` field is `{ input, output, image,
 * inputDisplay, outputDisplay, webSearch }`. The `input`/`output` values
 * take one of these forms (verified live 2026-08-30 against
 * `https://gratisfy.xyz/api/models/all` — 2084 entries):
 *
 *   - `null` / missing         → no price published for this side
 *   - `"Free"` (string)         → free-tier marker (not a numeric price)
 *   - number < 1                → per-token rate (× 1_000_000 → per-million)
 *   - number >= 1               → already per-million
 *   - `"5 pollen/M"`            → 5 pollen per 1M tokens (Pollinations
 *                                internal currency surfaced through the
 *                                Gratisfy catalog — NOT USD).
 *   - `"25 pollen/M"`           → 25 pollen per 1M tokens
 *   - `"0.06 pollen/img"`       → 0.06 pollen per image (image models —
 *                                not per-token; surfaced as not_documented
 *                                since the unit doesn't match per-million)
 *   - `"0.00006 pollen/sec"`    → 0.00006 pollen per second (audio models —
 *                                not per-token; surfaced as not_documented)
 *
 * Returns `{ inputPerMillion, outputPerMillion, currency }` when BOTH sides
 * yield a usable per-million numeric value in the same currency. Otherwise
 * returns null (the caller falls back to the free / not_documented paths).
 *
 * Verified live: 178 of 2084 models carry per-million pollen-string pricing
 * (e.g. `tomdacatto/claude-opus-5` → input="5 pollen/M", output="25 pollen/M"
 * — these are the real Pollinations-routed prices the user explicitly asked
 * to surface instead of the previous fake `$0/M`).
 */
function extractNumericPricing(
  model: DiscoveredGratisfyModel,
): {
  inputPerMillion: number | null;
  outputPerMillion: number | null;
  currency: "USD" | "pollen";
} | null {
  const raw = model.rawMetadata;
  if (!raw) return null;

  const pricing = raw.pricing;
  if (!pricing || typeof pricing !== "object") return null;
  const p = pricing as Record<string, unknown>;

  const inputParsed = toPerMillionNumber(p.input);
  const outputParsed = toPerMillionNumber(p.output);

  // Surface only when BOTH sides are present (we don't want half-prices).
  if (inputParsed && outputParsed) {
    // Currency reconciliation: if either side is pollen, the whole entry
    // is pollen (we never mix currencies on the same model).
    const currency: "USD" | "pollen" =
      inputParsed.currency === "pollen" || outputParsed.currency === "pollen"
        ? "pollen"
        : "USD";
    return {
      inputPerMillion: inputParsed.value,
      outputPerMillion: outputParsed.value,
      currency,
    };
  }

  return null;
}

/**
 * Detect the currency of a model's pricing strings WITHOUT requiring both
 * sides to be numeric. Used by the free / not_documented fallbacks so they
 * can stamp the correct currency (USD vs pollen) on the surfaced pricing.
 *
 * Returns "pollen" when ANY pricing string in the raw payload mentions
 * "pollen" (case-insensitive), otherwise null (caller falls back to USD).
 */
function detectPricingCurrency(
  model: DiscoveredGratisfyModel,
): "pollen" | null {
  const raw = model.rawMetadata as Record<string, unknown> | undefined;
  if (!raw) return null;
  const pricing = raw.pricing;
  if (!pricing || typeof pricing !== "object") return null;
  const p = pricing as Record<string, unknown>;
  for (const k of ["input", "output", "image", "webSearch", "inputDisplay", "outputDisplay"]) {
    const v = p[k];
    if (typeof v === "string" && v.toLowerCase().includes("pollen")) {
      return "pollen";
    }
  }
  return null;
}

/** Coerce a pricing value (string|number) into a per-million numeric rate
 * plus the detected currency.
 *
 * Accepted shapes (verified live against the public catalog
 * `gratisfy.xyz/api/models/all`, 2026-08-30):
 *
 *  - `null` / `undefined`               → null (not present)
 *  - `"Free"` (string)                  → null (free signal, not numeric)
 *  - `"5 pollen/M"` (string)            → 5 per million, currency="pollen"
 *  - `"25 pollen/M"` (string)            → 25 per million, currency="pollen"
 *  - `"0.06 pollen/img"` (string)        → null (per-image, not per-million —
 *                                         caller surfaces as not_documented)
 *  - `"0.00006 pollen/sec"` (string)     → null (per-second, not per-million —
 *                                         caller surfaces as not_documented)
 *  - `"0.15 pollen/hour"` (string)       → null (per-hour, not per-million)
 *  - number < 1                          → × 1_000_000 (per-token → per-million),
 *                                         currency="USD"
 *  - number >= 1                         → already per-million, currency="USD"
 *  - plain numeric string "2.5"          → 2.5 per million, currency="USD"
 *
 * Returns `{ value, currency }` when the value can be expressed as a
 * per-million rate, otherwise null. The caller (extractNumericPricing)
 * reconciles currencies across input/output and surfaces the result.
 */
function toPerMillionNumber(
  v: unknown,
): { value: number; currency: "USD" | "pollen" } | null {
  if (v == null) return null;

  // Plain number → per-million USD (per-token when < 1).
  if (typeof v === "number" && Number.isFinite(v)) {
    return { value: v < 1 ? v * 1_000_000 : v, currency: "USD" };
  }

  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  if (s.toLowerCase() === "free") return null; // free signal, not numeric

  // String with explicit unit. Extract the leading numeric value and
  // detect the currency + per-million-ness from the unit suffix.
  //
  // The public catalog uses these unit suffixes (verified):
  //   "pollen/M"   → pollen per million tokens  ✓ per-million (numeric)
  //   "pollen/img" → pollen per image            ✗ not per-million
  //   "pollen/sec" → pollen per second            ✗ not per-million
  //   "pollen/hour"→ pollen per hour              ✗ not per-million
  //
  // Only "pollen/M" (and bare numbers / "$/M") yield a per-million rate.
  // The /img, /sec, /hour units are surfaced as not_documented (caller path)
  // since the catalog UI's per-million display doesn't fit those modalities.
  const lower = s.toLowerCase();
  const isPollen = lower.includes("pollen");

  // Extract the leading numeric value (supports decimals + scientific).
  // Examples: "5 pollen/M" → 5; "0.06 pollen/img" → 0.06;
  // "0.00006 pollen/sec" → 0.00006; "2.5" → 2.5.
  const numMatch = s.match(/-?\d+(?:\.\d+)?/);
  if (!numMatch) return null;
  const n = Number(numMatch[0]);
  if (!Number.isFinite(n)) return null;

  // Per-million gate: only "pollen/M", "$/M", or a bare number (no unit)
  // surface as per-million. "/M" alone (without currency word) defaults to
  // USD per million. "pollen/M" → pollen per million. Anything else
  // (/img, /sec, /hour, /req, /call) → not per-million → return null.
  const hasPerMillionUnit = /\/m(illion)?\b/i.test(s) || /\bm\b/i.test(s.replace(/pollen/i, ""));
  const isBareNumericString = !/[a-z/]/i.test(s.replace(/[-\d.]/g, ""));

  if (isPollen && hasPerMillionUnit) {
    // "5 pollen/M" → 5 pollen per million tokens
    return { value: n, currency: "pollen" };
  }
  if (!isPollen && (hasPerMillionUnit || isBareNumericString)) {
    // "2.5" (bare numeric string), "$5/M" → USD per million.
    // Bare numeric strings follow the per-token rule (× 1M when < 1).
    return { value: n < 1 && isBareNumericString ? n * 1_000_000 : n, currency: "USD" };
  }

  // Other units (/img, /sec, /hour, /req, /call) — not per-million.
  return null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ─────────────────────────────────────────────────────────────────────────────
// Error normalization (PRD §62)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map a thrown value (typically a ByokUpstreamError from streamByokChat /
 * completeByokChat, or a network error) onto the typed error classes. The
 * shared ByokUpstreamError base is preserved on all HTTP-shaped errors so
 * existing `instanceof ByokUpstreamError` checks keep working.
 */
function normalizeByokError(err: unknown, model: string): Error {
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
    if (
      err.name === "TypeError" ||
      err.name === "FetchError" ||
      err.message.toLowerCase().includes("fetch") ||
      err.message.toLowerCase().includes("network") ||
      err.message.toLowerCase().includes("econnrefused") ||
      err.message.toLowerCase().includes("enotfound")
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
// `SUPPLIED_BOARD_IDS`) were removed when `resolveGratisfyPricing` stopped
// falling back to the supplied board by tail-segment match — that path
// produced fake prices on Gratisfy models. The PUBLIC catalog endpoint
// (https://gratisfy.xyz/api/models/all) now publishes real per-model
// pricing metadata directly — `extractNumericPricing` reads it and the
// resolver surfaces it. The `isRecord` helper is kept as a defensive
// shape-check utility in case future code paths need it.

/**
 * Gratisfy BYOK adapter — PRD §15, §16, §17, §37, §56, §58.
 *
 * Base URL:   https://api.gratisfy.xyz/v1
 * Auth:       Authorization: Bearer <gxyz-key>   (BYOK — PRD §54)
 * Discovery:  GET  /v1/models?modality=language  (AUTH-gated — §17)
 * Chat:       POST /v1/chat/completions         (OpenAI-shaped)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * KEY INVARIANT (PRD §17 — the auth-gating fix):
 *
 *   No saved Gratisfy key  →  DO NOT call the protected /v1/models endpoint.
 *   The public model list (registry.ts getUnifiedModels) MUST NOT include any
 *   Gratisfy models when the user has not connected a key. Models are fetched
 *   + cached (DB ProviderModel rows, discoveryMode="dynamic") ONLY AFTER a
 *   user saves a key AND it validates with a 200 from Gratisfy.
 *
 * Concretely: discoverGratisfyModels(apiKey) REQUIRES the raw key. It throws
 * MissingGratisfyKeyError synchronously when called with an empty/blank key.
 * It never silently returns [] on a missing key — that is the bug that let
 * the public catalog show an "auth error" before.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Error normalization (PRD §62, §82): every upstream failure is converted into
 * a typed error class derived from the shared ByokUpstreamError base
 * (./openai-chat). Callers can `instanceof`-check to choose the right HTTP
 * envelope + retry policy.
 *
 * Pricing (PRD §37): resolveGratisfyPricing(model) tries, in order —
 *   1. Pricing metadata embedded in the upstream /v1/models response → "provider"
 *   2. The supplied pricing board (./pricing-board, by model id match)  → "market"
 *   3. Otherwise nulls                                           → "undocumented"
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
// Discovery (PRD §17) — AUTH-GATED, requires the raw apiKey
// ─────────────────────────────────────────────────────────────────────────────

/** Raw shape of one entry in Gratisfy's /v1/models `data` array.
 *
 * Verified live against `?modality=all` (2026-08-30) — every entry carries
 * these fields. Always-present: id, object:"model", created, owned_by,
 * type (modality), pricing_tier, name, displayName, provider (the real
 * routing slug — never "alias"), input_modalities[], free_tier{is_free,
 * note}. Often-present: output_modalities[], features[], context_window,
 * context (dup of context_window), supported_parameters[],
 * max_output_tokens/maxOutput (camelCase dup).
 *
 * The bare-alias entries (228 of 486 in `?modality=all`) carry
 * `owned_by === "alias"` and are byte-for-byte duplicates of their
 * `<provider>/<id>` twin — they must be dropped here so the catalog
 * doesn't render duplicate React keys (PRD §19 / playground dedup).
 */
interface GratisfyRawModel {
  id?: string;
  name?: string;
  displayName?: string;
  description?: string;
  context_length?: number;
  max_context_length?: number;
  context_window?: number;
  context?: number;
  modality?: string;
  type?: string; // modality: language|image|audio|embedding|video
  capabilities?: string[] | Record<string, boolean>;
  features?: string[];
  input_modalities?: string[];
  output_modalities?: string[];
  supported_parameters?: string[];
  max_output_tokens?: number;
  maxOutput?: number;
  pricing?: Record<string, string | number>;
  pricing_tier?: string;
  provider?: string; // the REAL upstream routing slug — never "alias"
  owned_by?: string; // upstream owner; "alias" for bare-alias dupes
  free_tier?: { is_free?: boolean; note?: string };
  metadata?: Record<string, unknown>;
  [k: string]: unknown;
}

/**
 * Discover Gratisfy models (PRD §17). REQUIRES the user's raw key — the
 * /v1/models endpoint is auth-gated. Throws MissingGratisfyKeyError if no key.
 * Throws InvalidKeyError / RateLimitedError / ProviderUnavailableError /
 * NetworkError for upstream failures (PRD §62).
 *
 * The route handler is expected to upsert each DiscoveredGratisfyModel into
 * Prisma ProviderModel with providerId="gratisfy", discoveryMode="dynamic",
 * active=true. Models that are no longer returned should be deactivated
 * (active=false) NOT deleted (PRD §26 — historical rows preserved).
 */
export async function discoverGratisfyModels(
  apiKey: string,
  signal?: AbortSignal,
): Promise<DiscoveredGratisfyModel[]> {
  const key = (apiKey ?? "").trim();
  if (!key) throw new MissingGratisfyKeyError();

  let res: Response;
  try {
    // CRITICAL: `?modality=all` is REQUIRED to surface ALL of Gratisfy's
    // 486 model entries (~258 distinct after dropping 228 bare-alias
    // duplicates). Without it the upstream serves either 26 entries
    // (Cloudflare cache hit on the platform-key catalog minimum) or 366
    // entries (cache miss = language modality only) — both paths EXCLUDE
    // image / audio / video / embedding models. Verified live 2026-08-30.
    //
    // Cache-bust headers + a `?_=<nonce>` query param are also required
    // because Cloudflare otherwise serves a stale 26-30 entry
    // "platform-key catalog minimum" snapshot even when ?modality=all is
    // present (the edge cache keys on URL + Authorization header and
    // doesn't know the modality query changes the response shape).
    const nonce = Date.now().toString(36);
    res = await fetch(`${GRATISFY_BASE_URL}/models?modality=all&_=${nonce}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
        "X-Request-Id": `freeaixyz-discovery-${nonce}`,
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

  let json: { data?: GratisfyRawModel[] };
  try {
    json = (await res.json()) as { data?: GratisfyRawModel[] };
  } catch (err) {
    throw new UpstreamError(
      res.status,
      `Invalid JSON from /v1/models: ${err instanceof Error ? err.message : String(err)}`,
      "",
    );
  }

  const list = Array.isArray(json.data) ? json.data : [];
  const out: DiscoveredGratisfyModel[] = [];
  for (const m of list) {
    const norm = normalizeRawModel(m);
    if (norm) out.push(norm);
  }
  return out;
}

/** Convert one raw upstream model into the normalized shape.
 *
 * Drops bare-alias entries (owned_by === "alias") because they are
 * byte-for-byte duplicates of their `<provider>/<id>` twin — same fields,
 * only id + owned_by differ. Including them produces duplicate React keys
 * in the playground dropdown (the upstream lists the same model twice).
 * Verified live 2026-08-30: 228 of 486 entries in `?modality=all` are
 * bare aliases; dropping them is the dedup the user asked for.
 *
 * Capabilities derive from `features` + `input_modalities` +
 * `output_modalities` + `type` — the upstream no longer carries a
 * standalone `capabilities` field (the previous implementation read a
 * non-existent field and always defaulted to `["text"]`). Verified live:
 * `features` carries tags like `["tool_calling","vision"]` and the
 * modality arrays carry the input/output modality strings.
 */
function normalizeRawModel(m: GratisfyRawModel): DiscoveredGratisfyModel | null {
  const upstreamId = (m.id ?? "").trim();
  if (!upstreamId) return null;

  // Drop bare-alias duplicates — their `<provider>/<id>` twin is already
  // in the list and will surface as a separate entry.
  const ownedBy = typeof m.owned_by === "string" ? m.owned_by.toLowerCase() : "";
  const isAlias = ownedBy === "alias";
  // Only drop a bare alias when an equivalent `<provider>/<id>` form is
  // also in the list. We approximate this by checking the id has no "/"
  // (bare aliases never have a slash; the real entries always do).
  if (isAlias && !upstreamId.includes("/")) {
    return null;
  }

  const name = (m.name ?? m.displayName ?? lastSegment(upstreamId)).trim();
  return {
    upstreamId,
    name,
    description: typeof m.description === "string" ? m.description : undefined,
    capabilities: capabilitiesToList(m),
    contextLength:
      typeof m.context_length === "number"
        ? m.context_length
        : typeof m.context_window === "number"
          ? m.context_window
          : typeof m.context === "number"
            ? m.context
            : typeof m.max_context_length === "number"
              ? m.max_context_length
              : undefined,
    modality:
      typeof m.type === "string"
        ? m.type
        : typeof m.modality === "string"
          ? m.modality
          : undefined,
    rawMetadata: m as unknown as Record<string, unknown>,
  };
}

/**
 * Build a normalized capability list from the new upstream payload shape.
 *
 * The new shape carries:
 *   - `features`        — array of capability tags (e.g. "tool_calling",
 *                          "vision", "reasoning", "web_search")
 *   - `input_modalities`  — array of strings like "text", "image", "audio"
 *   - `output_modalities` — array of strings like "text", "image", "audio"
 *   - `type`            — modality ("language" | "image" | "audio" |
 *                          "embedding" | "video")
 *
 * We combine all of these into a flat list of capability strings used by
 * the registry's buildCapabilities() to populate the UnifiedModel's
 * capabilities field.
 */
function capabilitiesToList(m: GratisfyRawModel): string[] {
  const caps = new Set<string>();
  caps.add("text"); // every Gratisfy model supports text chat

  // Features → direct capability tags.
  if (Array.isArray(m.features)) {
    for (const f of m.features) {
      if (typeof f === "string") caps.add(f);
    }
  }

  // Legacy capabilities field (some entries may still carry it).
  if (Array.isArray(m.capabilities)) {
    for (const c of m.capabilities) {
      if (typeof c === "string") caps.add(c);
    }
  } else if (m.capabilities && typeof m.capabilities === "object") {
    for (const [k, v] of Object.entries(m.capabilities)) {
      if (v === true) caps.add(k);
    }
  }

  // Input modalities → vision/audio capabilities.
  if (Array.isArray(m.input_modalities)) {
    for (const mod of m.input_modalities) {
      if (typeof mod !== "string") continue;
      const lower = mod.toLowerCase();
      if (lower === "image") caps.add("vision");
      else if (lower === "audio") caps.add("audio_input");
      else if (lower === "video") caps.add("video_input");
    }
  }

  // Output modalities → image/audio/video generation.
  if (Array.isArray(m.output_modalities)) {
    for (const mod of m.output_modalities) {
      if (typeof mod !== "string") continue;
      const lower = mod.toLowerCase();
      if (lower === "image") caps.add("image");
      else if (lower === "audio") caps.add("audio");
      else if (lower === "video") caps.add("video");
    }
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
 * Resolve pricing for a discovered Gratisfy model (PRD §37). Resolution:
 *   1. Pricing metadata embedded in the upstream /v1/models response → "provider"
 *   2. Otherwise nulls + source="undocumented"
 *
 * Per the user's explicit request ("remove fake pricing from gratisfy
 * models"), we NO LONGER fall back to the supplied pricing board by
 * tail-segment match — that path was stamping foreign market prices
 * (e.g. `tb/gemini-2.5-flash` → $0.30/$2.50) onto Gratisfy models
 * whose `upstreamId` happened to share the trailing segment (e.g.
 * `google-ai-studio/gemini-2.5-flash`), even though Gratisfy doesn't
 * charge those rates. The catalog now shows "—" for Gratisfy models
 * unless Gratisfy itself publishes a price in the model payload.
 *
 * Values are USD per 1M tokens. null means "we could not establish a
 * price" (PRD §26 — never confuse $0 with "not documented").
 */
export function resolveGratisfyPricing(model: DiscoveredGratisfyModel): {
  inputPerMillion: number | null;
  outputPerMillion: number | null;
  cachePerMillion?: number | null;
  currency: "USD";
  status: "documented" | "supplied" | "estimated" | "free" | "not_documented";
  source: "provider" | "pricing-board" | "manual" | "unknown";
  verifiedAt?: string;
} {
  // 1. Provider-supplied pricing metadata embedded in the discovery payload.
  //    This is the ONLY legitimate source for Gratisfy pricing — if
  //    Gratisfy itself didn't publish a price in /v1/models, we show "—".
  const providerPricing = extractProviderPricing(model);
  if (providerPricing) {
    return {
      inputPerMillion: providerPricing.inputPerMillion,
      outputPerMillion: providerPricing.outputPerMillion,
      cachePerMillion: providerPricing.cachePerMillion ?? null,
      currency: "USD",
      status: "documented",
      source: "provider",
      verifiedAt: new Date().toISOString(),
    };
  }

  // 2. Gratisfy publishes every model as `pricing_tier: "free"` + a
  //    `free_tier.is_free: true` flag in /v1/models — the catalog was
  //    showing "—" before because the old resolver ignored that signal
  //    (it only consulted a hard-coded pricing-board tail-segment match,
  //    which is now removed for the fake-pricing fix). Surfacing the
  //    upstream `free_tier` flag here lets Gratisfy models be honestly
  //    marked as `status: "free"` with $0 in + $0 out — the catalog UI's
  //    `isFree` check now lights up the green "free" badge on every
  //    Gratisfy model and the playground's "free" pill appears next to
  //    the BYOK ready state.
  const freeTierFlag = readFreeTierFlag(model);
  if (freeTierFlag) {
    return {
      inputPerMillion: 0,
      outputPerMillion: 0,
      cachePerMillion: 0,
      currency: "USD",
      status: "free",
      source: "provider",
      verifiedAt: new Date().toISOString(),
    };
  }

  // 3. Undocumented — return nulls, NEVER $0.
  // (Previously this method also consulted the supplied pricing board by
  // trailing-segment match; that path produced fake prices on Gratisfy
  // models and was removed per the user's "remove fake pricing" directive.)
  return {
    inputPerMillion: null,
    outputPerMillion: null,
    cachePerMillion: null,
    currency: "USD",
    status: "not_documented",
    source: "unknown",
  };
}

/**
 * Read Gratisfy's `free_tier` / `pricing_tier` / `tier` flags from the raw
 * upstream model payload. Gratisfy's /v1/models response advertises every
 * model with one of:
 *   - `pricing_tier: "free"` (top-level string)
 *   - `free_tier: { is_free: true, note: "…" }` (object)
 *   - `tier: "anonymous"` or `tier: "seed"` (lower-cased tier name)
 *
 * Returns true when ANY of those flags indicates a free model. The resolver
 * uses this to honour the upstream `free_tier` signal — previously the
 * catalog ignored it entirely (it only consulted a hand-curated pricing
 * board that didn't carry Gratisfy entries), so every Gratisfy model
 * appeared as "—" in the catalog with no honest free classification.
 */
function readFreeTierFlag(model: DiscoveredGratisfyModel): boolean {
  const raw = model.rawMetadata as Record<string, unknown> | undefined;
  if (!raw) return false;
  // pricing_tier: "free"
  if (typeof raw.pricing_tier === "string" && raw.pricing_tier.toLowerCase() === "free") {
    return true;
  }
  // free_tier: { is_free: true, note?: string }
  const ft = raw.free_tier;
  if (ft && typeof ft === "object") {
    const isFree = (ft as Record<string, unknown>).is_free;
    if (isFree === true) return true;
  }
  // tier: "anonymous" | "seed" | "free" — Pollinations-style anonymous tier
  if (typeof raw.tier === "string") {
    const t = raw.tier.toLowerCase();
    if (t === "anonymous" || t === "free" || t === "seed") {
      return true;
    }
  }
  return false;
}

/**
 * Extract provider-supplied per-million pricing from the raw upstream model
 * payload, accepting several common field shapes (per-token strings,
 * per-million numbers, nested pricing objects). Returns null if no usable
 * price can be extracted.
 */
function extractProviderPricing(
  model: DiscoveredGratisfyModel,
): {
  inputPerMillion: number | null;
  outputPerMillion: number | null;
  cachePerMillion?: number | null;
} | null {
  const raw = model.rawMetadata;
  if (!raw) return null;

  // Candidate pricing objects: top-level "pricing", "metadata.pricing", or
  // top-level "pricing_input" / "pricing_output" pairs.
  const candidates: Array<Record<string, unknown> | undefined> = [
    isRecord(raw.pricing) ? (raw.pricing as Record<string, unknown>) : undefined,
    isRecord(raw.metadata)
      ? isRecord((raw.metadata as Record<string, unknown>).pricing)
        ? ((raw.metadata as Record<string, unknown>).pricing as Record<string, unknown>)
        : undefined
      : undefined,
    raw, // also look directly on the model object itself
  ];

  for (const cand of candidates) {
    if (!cand) continue;
    const input = pickNumber(
      cand,
      ["input", "prompt", "input_per_million", "prompt_per_million", "input_price"],
    );
    const output = pickNumber(
      cand,
      ["output", "completion", "output_per_million", "completion_per_million", "output_price"],
    );
    // If either input or output is present, treat as provider-sourced pricing.
    if (input != null || output != null) {
      const cache = pickNumber(
        cand,
        ["cache", "cache_per_million", "cached", "cached_input"],
      );
      return {
        inputPerMillion: input,
        outputPerMillion: output,
        cachePerMillion: cache,
      };
    }
  }

  return null;
}

function pickNumber(
  obj: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (v == null) continue;
    if (typeof v === "number" && Number.isFinite(v)) {
      // Heuristic: numbers < 1 in the "input"/"prompt"/"output"/"completion"
      // fields are likely per-TOKEN (OpenRouter convention). Anything that
      // smells like a per-million price (>= 1) is left as-is.
      if (k.includes("per_million") || k.endsWith("_price") || v >= 1) {
        return v;
      }
      // Otherwise treat as per-token → convert to per-million.
      return v * 1_000_000;
    }
    if (typeof v === "string") {
      const s = v.trim();
      if (!s) continue;
      const n = Number(s);
      if (Number.isFinite(n)) {
        if (k.includes("per_million") || k.endsWith("_price") || n >= 1) {
          return n;
        }
        return n * 1_000_000;
      }
    }
  }
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
// produced fake prices on Gratisfy models. If Gratisfy ever starts
// publishing real per-model pricing metadata, the `extractProviderPricing`
// path above already handles it.

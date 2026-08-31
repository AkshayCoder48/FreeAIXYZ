/**
 * Pollinations BYOK adapter — switched to the new gen.pollinations.ai host.
 *
 * Background:
 *   On 2026-08-30 the user pointed out that https://gen.pollinations.ai/docs
 *   is the NEW Pollinations API docs page, and the old text.pollinations.ai
 *   endpoint was returning a single-model anonymous list (`openai-fast`).
 *   Research against the new host returned 320 models with rich metadata
 *   (brand, category, paid_only, full pollen-token pricing).
 *
 * Endpoints (new host — gen.pollinations.ai):
 *   Models:    GET  https://gen.pollinations.ai/models
 *              (PUBLIC — security:[] in the OpenAPI spec; anonymous 200,
 *               returns 320 models with full pricing + brand + category)
 *   OpenAI:    GET  https://gen.pollinations.ai/v1/models
 *              (OpenAI-shape list, stripped per-model fields — same 320 entries)
 *   Chat:      POST https://gen.pollinations.ai/v1/chat/completions
 *              (OpenAI-shaped; verified live 200 anonymous with `openai` model)
 *   Validate:  GET  https://gen.pollinations.ai/account/profile
 *              (AUTH-GATED — 401 for missing/invalid tokens; this is the only
 *               endpoint that actually distinguishes valid from invalid keys,
 *               because /models is public and 200s without auth)
 *   Account:   GET  https://gen.pollinations.ai/account/balance   (paid pollen)
 *              GET  https://gen.pollinations.ai/account/key        (key meta)
 *
 * Auth scheme: HTTP Bearer (Authorization: Bearer <pk_or_sk_key>). Both
 * publishable (pk_) and secret (sk_) keys are accepted as Bearer. Query
 * param fallback `?key=<pk_or_sk>` is also documented.
 *
 * Per-model classification fields on the new host (replaces the OLD `tier`
 * field which has been REMOVED from the API):
 *   - `category`  (text|image|audio|video|realtime|embedding|3d) — modality
 *   - `brand`     (OpenAI|Qwen|LLM7.io|Anthropic|Google|ElevenLabs|…) — provider
 *   - `paid_only` (true|false|missing) — false/missing → free tier
 *   - `community` (true|false) — community-contributed vs official
 *   - `alpha`    (true|false)
 *   - `flat_rate`(true|false) — image/video models charged per-image, not per-token
 *
 * Pricing: every model carries a `pricing` object with `currency:"pollen"`
 * (Pollinations internal token, NOT USD — 1 pollen ≠ $1) and per-token rates.
 * The FreeAIXYZ gateway pegs 1 pollen = 1 XYZ (see POLLEN_XYZ_PEG in
 * ./pricing-board.ts), so pollen-denominated prices are billed + displayed
 * in the gateway's XYZ currency at par.
 *   {
 *     "currency": "pollen",
 *     "promptTextTokens":          "0.00000015",
 *     "promptCachedTokens":        "0.000000015",
 *     "promptCacheWriteTokens":    "0.000000038",
 *     "promptImageTokens":         "0.000000075",
 *     "promptVideoTokens":         "0.00000003",
 *     "completionTextTokens":      "0.0000009375",
 *     "completionReasoningTokens":"0.0000044",
 *     "completionImageTokens":     "0.004",
 *     "completionAudioTokens":     "0.0001"
 *   }
 *
 * The catalog UI shows pollen pricing as XYZ (1 pollen = 1 XYZ peg) rather
 * than mislabeling it as USD (PRD §26 — never confuse $0 with "not
 * documented"; never present a different currency's price as USD).
 */

export interface DiscoveredPollinationsModel {
  upstreamId: string;
  name: string;
  description?: string;
  capabilities: string[];
  contextLength?: number;
  modality?: string;
  /** The brand field (e.g. "OpenAI", "Qwen", "Anthropic") — used as the
   *  provider segment in the unified id `pollinations:<brand>:<name>`. */
  brand?: string;
  /** The Pollinations category: text|image|audio|video|realtime|embedding|3d. */
  category?: string;
  /** True when this model requires a paid pollen balance (paid_only). */
  paidOnly?: boolean;
  /** True for community-contributed models (vs official). */
  community?: boolean;
  /** True for image/video models charged per-image, not per-token. */
  flatRate?: boolean;
  rawMetadata?: Record<string, unknown>;
}

export interface PollinationsValidationResult {
  ok: boolean;
  error?: string;
  modelCount?: number;
}

const MODELS_URL = "https://gen.pollinations.ai/models";
const USERINFO_URL = "https://gen.pollinations.ai/account/profile";
const AUTHORIZE_URL = "https://enter.pollinations.ai/authorize";
const TOKEN_URL = "https://enter.pollinations.ai/api/token";
const TIMEOUT_MS = 15_000;

/**
 * The publishable Pollinations app key (pk_-prefixed). Safe to expose in
 * the browser — it can only initiate the OAuth flow, never withdraw
 * funds or read another user's balance. Read from NEXT_PUBLIC_POLLINATIONS_APP_KEY
 * so both server + client can resolve it.
 */
export function getPollinationsAppKey(): string {
  return (
    process.env.NEXT_PUBLIC_POLLINATIONS_APP_KEY ||
    process.env.POLLINATIONS_APP_KEY ||
    ""
  );
}

/**
 * Build the OAuth authorize URL for the "Connect your Pollinations Wallet"
 * button. The user is sent to enter.pollinations.ai/authorize with our app
 * key as client_id and our /api/v1/byok/pollinations/connect as the
 * redirect_uri.
 *
 * PKCE (Proof Key for Code Exchange, RFC 7636) is MANDATORY as of 2026-08-30:
 * the Pollinations authorization server returns
 *   "PKCE code_challenge is required for the authorization code flow"
 * if the authorize request omits code_challenge. We use the S256 method:
 *   code_verifier   = base64url(random(32 bytes))                      (~43 chars)
 *   code_challenge  = base64url(SHA-256(code_verifier))
 *   code_challenge_method = "S256"
 *
 * The caller MUST persist `codeVerifier` (and `state`) in a same-origin
 * cookie so the /api/v1/byok/pollinations/connect handler can replay the
 * verifier against the token endpoint. SameSite=Lax is required so the
 * cookie is sent on the top-level redirect back from enter.pollinations.ai.
 *
 * This function is callable from both server and client (it only reads the
 * publishable env var, never the secret). `codeChallenge` is passed in by
 * the caller because computing SHA-256 is async (crypto.subtle.digest) and
 * the caller chooses where to compute it.
 */
export function buildPollinationsAuthorizeUrl(opts: {
  /** Absolute origin for the callback redirect, e.g. https://freeaixyz4all.vercel.app */
  origin: string;
  /** Optional opaque state — defaults to a fresh hex string. */
  state?: string;
  /** PKCE code_challenge (base64url(SHA-256(code_verifier))). REQUIRED — the
   *  Pollinations authorize endpoint rejects requests without it. */
  codeChallenge: string;
  /** Always "S256" — exposed for completeness. */
  codeChallengeMethod?: "S256";
}): { url: string; state: string } | null {
  const appKey = getPollinationsAppKey();
  if (!appKey) return null;
  const redirectUri = `${opts.origin.replace(/\/$/, "")}/api/v1/byok/pollinations/connect`;
  const state =
    opts.state ||
    (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)) +
      Date.now().toString(36);
  const params = new URLSearchParams({
    client_id: appKey,
    response_type: "code",
    redirect_uri: redirectUri,
    state,
    scope: "openid profile",
    code_challenge: opts.codeChallenge,
    code_challenge_method: opts.codeChallengeMethod ?? "S256",
  });
  return { url: `${AUTHORIZE_URL}?${params.toString()}`, state };
}

/**
 * Generate a PKCE pair (S256) for the Pollinations OAuth flow.
 *   code_verifier  = base64url(32 random bytes)  → 43 chars, [A-Za-z0-9-_]
 *   code_challenge = base64url(SHA-256(verifier))
 *
 * Async because SHA-256 uses crypto.subtle.digest. Falls back to a
 * synchronous plain-method challenge only if crypto.subtle is unavailable
 * (very old runtimes); in that case the challenge equals the verifier and
 * the caller must send code_challenge_method=plain instead.
 */
export async function generatePollinationsPkcePair(): Promise<{
  verifier: string;
  challenge: string;
  method: "S256" | "plain";
}> {
  const bytes = new Uint8Array(32);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  const verifier = base64UrlEncode(bytes);
  // crypto.subtle is available in all modern browsers (https/localhost) and
  // in Node 18+ (Web Crypto API). Compute S256 challenge.
  if (typeof globalThis.crypto?.subtle?.digest === "function") {
    const hashBuf = await globalThis.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(verifier),
    );
    return {
      verifier,
      challenge: base64UrlEncode(new Uint8Array(hashBuf)),
      method: "S256" as const,
    };
  }
  // Fallback (shouldn't happen on Vercel/modern browsers): plain method.
  return { verifier, challenge: verifier, method: "plain" as const };
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = typeof btoa === "function" ? btoa(bin) : Buffer.from(bytes).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Exchange an OAuth authorization code for a Pollinations Bearer token.
 * POSTs to https://enter.pollinations.ai/api/token with the standard
 * OAuth2 `authorization_code` grant shape:
 *   { grant_type: "authorization_code", code, redirect_uri, client_id,
 *     code_verifier }   ← code_verifier is REQUIRED when the authorize
 *   request used PKCE (which we always do now — see
 *   buildPollinationsAuthorizeUrl).
 *
 * Returns the token string on success, throws on failure. The caller
 * (the callback route handler) is responsible for persisting the token
 * under the user's account.
 *
 * NOTE: Pollinations' token endpoint is undocumented in our codebase. We
 * follow the OAuth2 convention; if Pollinations' endpoint follows a
 * different shape, this function will throw and the user will see a
 * friendly "Connect manually instead" message in the callback UI.
 */
export async function exchangePollinationsCodeForToken(opts: {
  code: string;
  /** Must match the redirect_uri passed to buildPollinationsAuthorizeUrl. */
  redirectUri: string;
  /** PKCE code_verifier — REQUIRED (we always send code_challenge in the
   *  authorize request). The token endpoint re-hashes this and compares
   *  to the code_challenge we sent. */
  codeVerifier: string;
}): Promise<string> {
  const appKey = getPollinationsAppKey();
  if (!appKey) {
    throw new Error("POLLINATIONS_APP_KEY is not configured.");
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: opts.code,
      redirect_uri: opts.redirectUri,
      client_id: appKey,
      code_verifier: opts.codeVerifier,
    });
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Pollinations token exchange failed (HTTP ${res.status}): ${text.slice(0, 200)}`,
      );
    }
    const data = (await res.json().catch(() => null)) as
      | { access_token?: string; token?: string; id_token?: string; error?: string; error_description?: string }
      | null;
    const token = data?.access_token || data?.token || data?.id_token;
    if (!token) {
      const errDetail = data?.error_description || data?.error || "no access_token in response";
      throw new Error(`Pollinations token exchange returned no token: ${errDetail}`);
    }
    return token as string;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not exchange Pollinations code: ${msg}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Validate a Pollinations token.
 *
 * IMPORTANT: gen.pollinations.ai/models is PUBLIC — it returns 200 with the
 * full 320-model list even when no Authorization header is supplied. So
 * calling it with a fake Bearer token also returns 200 and a naive
 * validator would accept any string as "valid". To actually distinguish
 * valid from invalid tokens we hit the authenticated profile endpoint
 * instead — it returns 401 for missing/invalid tokens and 200 with the
 * caller's profile JSON for valid ones.
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
    // 1) Real validation: the profile endpoint requires a valid Bearer
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

/**
 * Classify a Pollinations model's capabilities from provider metadata
 * (PRD §2, §8, §9).
 *
 * Pollinations' `gen.pollinations.ai/models` payload carries:
 *   - `category`            — text|image|video|3d|audio|realtime|embedding
 *   - `input_modalities`    — ["text","image","audio",...]
 *   - `output_modalities`   — ["text","image","audio","video","3d",...]
 *   - `tools`               — boolean (tool/function calling)
 *   - `reasoning`           — boolean
 *
 * Capability derivation rules (PRD §9):
 *   text      ← category in [text, realtime] OR input ⊇ text OR output ⊇ text
 *   tts       ← category === "audio" (Pollinations audio IS text→speech)
 *               OR (input ⊇ text AND output ⊇ audio)
 *   stt       ← (input ⊇ audio) AND (output ⊇ text)
 *   image     ← category === "image" OR output ⊇ image
 *   video     ← category === "video" OR output ⊇ video
 *   vision    ← input ⊇ image
 *   embedding← category === "embedding"
 *   reasoning← reasoning === true
 *   tools    ← tools === true
 *
 * NOTE: a text model is NEVER auto-classified as tts/image/video — those
 * require the corresponding output modality or category (PRD §9 validation).
 */
function classifyPollinationsCapabilities(obj: Record<string, unknown>): string[] {
  const caps = new Set<string>();

  const inMods = (Array.isArray(obj.input_modalities) ? obj.input_modalities : []) as string[];
  const outMods = (Array.isArray(obj.output_modalities) ? obj.output_modalities : []) as string[];
  const inSet = new Set(inMods.map((s) => String(s).toLowerCase()));
  const outSet = new Set(outMods.map((s) => String(s).toLowerCase()));
  const hasTextInput = inSet.has("text");
  const hasImageInput = inSet.has("image");
  const hasAudioInput = inSet.has("audio");
  const hasTextOutput = outSet.has("text");
  const hasImageOutput = outSet.has("image");
  const hasAudioOutput = outSet.has("audio");
  const hasVideoOutput = outSet.has("video");

  const category = typeof obj.category === "string" ? obj.category.toLowerCase() : "";

  // text — chat/text-generation models only.
  const textCats = new Set(["text", "realtime"]);
  if (textCats.has(category) || hasTextInput || hasTextOutput) {
    caps.add("text");
  }

  // tts — text → speech. Pollinations `audio` category IS TTS (ElevenLabs).
  if (category === "audio" || (hasTextInput && hasAudioOutput)) {
    caps.add("tts");
    caps.add("audio");
  }

  // stt — speech → text.
  if (hasAudioInput && hasTextOutput) {
    caps.add("stt");
    caps.add("audio");
  }

  // image generation.
  if (category === "image" || hasImageOutput) {
    caps.add("image");
  }

  // video generation.
  if (category === "video" || hasVideoOutput) {
    caps.add("video");
  }

  // vision (image understanding).
  if (hasImageInput) {
    caps.add("vision");
  }

  // embedding.
  if (category === "embedding") {
    caps.add("embedding");
  }

  // realtime (voice/chat) → treat as text + audio (it carries both).
  if (category === "realtime" && hasAudioOutput) {
    caps.add("audio");
  }

  // tools + reasoning booleans.
  if (obj.tools === true) caps.add("tools");
  if (obj.reasoning === true) caps.add("reasoning");

  return Array.from(caps);
}

/**
 * Classify a Pollinations model's access tier (PRD §5, §6, §7).
 *
 * Pollinations publishes a per-model `paid_only` boolean. This is the
 * AUTHORITATIVE access signal — not an inference (PRD §7). When
 * `paid_only === true`, the model requires a paid pollen balance. When
 * `paid_only` is false or absent, the model is usable on the free
 * anonymous tier (Pollinations' documented free anonymous access).
 *
 * Free-Only mode (PRD §6) filters strictly on `access === "free"`.
 */
export function classifyPollinationsAccess(model: DiscoveredPollinationsModel): {
  access: "free" | "paid" | "freemium" | "unknown";
  reason: string;
} {
  const raw = model.rawMetadata as Record<string, unknown> | undefined;
  if (!raw) return { access: "unknown", reason: "no metadata" };

  // paid_only === true → PAID (requires pollen balance).
  if (raw.paid_only === true) {
    return {
      access: "paid",
      reason: "paid_only=true (requires paid pollen balance)",
    };
  }
  // paid_only === false → explicitly FREE.
  if (raw.paid_only === false) {
    return {
      access: "free",
      reason: "paid_only=false (anonymous tier)",
    };
  }
  // paid_only absent → the model is not marked paid, so it's usable on the
  // free anonymous tier. Pollinations' catalog explicitly marks paid models
  // with paid_only=true; its absence means free-tier access.
  return {
    access: "free",
    reason: "not paid_only (free anonymous tier)",
  };
}

/** Discover Pollinations models for the catalog (anonymous, no key needed).
 *
 * The user explicitly asked: "add pollinations model fetching api it can
 * too work anonymously so get it too" — so this function ALWAYS fetches
 * anonymously (no Authorization header). The new gen.pollinations.ai/models
 * endpoint is public (security:[] in the OpenAPI spec) and returns ALL 320
 * models including paid-only ones with full pricing.
 *
 * The returned DiscoveredPollinationsModel[] carries the `brand` field
 * (e.g. "OpenAI", "Qwen", "Anthropic") which the registry's
 * buildPollinationsModels uses as the provider segment in the unified id
 * `pollinations:<brand>:<name>` — so the catalog shows models grouped by
 * their real Pollinations brand, not a flat "pollinations" provider.
 */
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
    const out: DiscoveredPollinationsModel[] = [];
    for (const raw of list) {
      const obj = (raw ?? {}) as Record<string, unknown>;
      const id = typeof obj.name === "string"
        ? obj.name
        : typeof obj.id === "string"
          ? obj.id
          : "";
      if (!id) continue;
      const name = typeof obj.title === "string"
        ? obj.title
        : typeof obj.name === "string"
          ? obj.name
          : id;
      const desc = typeof obj.description === "string" ? obj.description : undefined;
      // PRD §2, §8, §9 — capability-driven classification. Derived ONLY
      // from provider metadata (`category`, `input_modalities`,
      // `output_modalities`, `tools`, `reasoning`). NEVER name-matching.
      // A model may carry several capabilities (multi-modal, PRD §3).
      const caps = classifyPollinationsCapabilities(obj);
      const ctx = typeof obj.context_length === "number" ? obj.context_length : undefined;
      const cat = typeof obj.category === "string" ? obj.category : undefined;
      const brand = typeof obj.brand === "string" ? obj.brand : undefined;
      const paidOnly = obj.paid_only === true;
      const community = obj.community === true;
      const flatRate = obj.flat_rate === true;
      out.push({
        upstreamId: id,
        name,
        description: desc,
        capabilities: caps,
        contextLength: ctx,
        modality: cat,
        brand,
        category: cat,
        paidOnly,
        community,
        flatRate,
        rawMetadata: obj,
      });
    }
    return out;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve pricing for a discovered Pollinations model.
 *
 * The new gen.pollinations.ai/models payload carries a `pricing` object
 * per model with currency="pollen" and per-token rates. Currency is
 * Pollinations internal "pollen" token — NOT USD. We surface the rates
 * in their original currency so the catalog UI can show "Pollen" pricing
 * rather than mislabeling as USD (PRD §26 — never confuse $0 with "not
 * documented"; never present a different currency as USD).
 *
 * The `status` field follows the existing convention:
 *   - paid_only===false (or missing) → status="free" (anonymous chat works free)
 *   - paid_only===true                → status="documented" (real pollen rates)
 *   - no pricing object at all        → status="not_documented" (nulls)
 */
export function resolvePollinationsPricing(model: DiscoveredPollinationsModel): {
  inputPerMillion: number | null;
  outputPerMillion: number | null;
  cachePerMillion?: number | null;
  currency: "USD" | "pollen";
  status: "documented" | "supplied" | "estimated" | "free" | "not_documented";
  source: "provider" | "pricing-board" | "manual" | "unknown";
  verifiedAt?: string;
} {
  const raw = model.rawMetadata as Record<string, unknown> | undefined;
  const pricing = raw?.pricing as Record<string, unknown> | undefined;

  // Free-tier model (paid_only === false or missing) → $0 across the board.
  // The new host's anonymous-tier is genuinely free for chat.
  if (!model.paidOnly) {
    return {
      inputPerMillion: 0,
      outputPerMillion: 0,
      cachePerMillion: 0,
      currency: "pollen",
      status: "free",
      source: "provider",
      verifiedAt: new Date().toISOString(),
    };
  }

  // Paid-only model → surface the real pollen rates per 1M tokens.
  // Per-token values in the payload are pollen/token; multiply by 1e6 to
  // express as pollen/1M tokens (the same denominator the rest of the
  // pricing board uses, so the catalog UI's "$X.XX / 1M" template works
  // — the currency badge clarifies it's pollen, not USD).
  if (pricing && typeof pricing === "object") {
    const toPerMillion = (v: unknown): number | null => {
      if (typeof v !== "string" && typeof v !== "number") return null;
      const n = typeof v === "string" ? Number(v) : v;
      if (!Number.isFinite(n)) return null;
      return n * 1_000_000;
    };
    const input = toPerMillion(pricing.promptTextTokens);
    const output = toPerMillion(pricing.completionTextTokens);
    const cache = toPerMillion(pricing.promptCachedTokens);
    if (input !== null && output !== null) {
      return {
        inputPerMillion: input,
        outputPerMillion: output,
        cachePerMillion: cache,
        currency: "pollen",
        status: "documented",
        source: "provider",
        verifiedAt: new Date().toISOString(),
      };
    }
  }

  // No pricing object at all → nulls + not_documented (PRD §26).
  return {
    inputPerMillion: null,
    outputPerMillion: null,
    cachePerMillion: null,
    currency: "pollen",
    status: "not_documented",
    source: "unknown",
  };
}

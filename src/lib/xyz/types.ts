/**
 * FreeAIXYZ Unified BYOK + XYZ Credit System — core types.
 *
 * Architecture (PRD §2): SOURCE → PROVIDER → MODEL are distinct concepts.
 *   Source: native | gratisfy | pollinations
 *   Provider: the underlying upstream (Google AI Studio, Gemini, OpenAI, …)
 *   Model: the actual model id
 *
 * Source-aware canonical ids (PRD §18):
 *   native:<provider>:<model>
 *   gratisfy:<provider>:<model>
 *   pollinations:<provider>:<model>
 */

export type Source = "native" | "gratisfy" | "pollinations";

/** Pricing status — never confuse "$0" with "not documented" (PRD §26). */
export type PricingStatus =
  | "documented" // upstream explicitly priced
  | "supplied" // baseline from the product-owner pricing board
  | "estimated"
  | "free" // explicitly free / open / no published charge
  | "not_documented"; // cannot establish a reliable price

export type PricingSource =
  | "provider"
  | "pricing-board"
  | "manual"
  | "unknown";

/** Per-model pricing (PRD §25). Values are per 1M tokens in the stated
 *  currency. `currency: "USD"` for USD-priced models; `currency: "pollen"`
 *  for Pollinations-internal-currency pricing surfaced through Gratisfy's
 *  catalog (the public catalog `https://gratisfy.xyz/api/models/all` lists
 *  Pollinations-routed models with pricing strings like `"5 pollen/M"` —
 *  these are NOT USD prices and must not be rendered as USD). The FreeAIXYZ
 *  gateway pegs 1 pollen = 1 XYZ (see POLLEN_XYZ_PEG in ./pricing-board.ts);
 *  pollen-denominated prices are billed + displayed in XYZ at par. */
export interface ModelPricing {
  inputPerMillion: number | null;
  outputPerMillion: number | null;
  cachePerMillion?: number | null;
  currency: "USD" | "pollen";
  status: PricingStatus;
  source: PricingSource;
  verifiedAt?: string;
}

/** Capabilities advertised for a model (PRD §14, §3).
 *
 * Derived ONLY from provider metadata (type, inputModalities,
 * outputModalities, features, category) — NEVER from name matching (PRD §2,
 * §8, §9). A model may carry several capabilities (multi-modal) and should
 * appear in every applicable UI filter (PRD §3).
 *
 * Capability semantics (PRD §9 — validation layer):
 *   text      — text generation / chat / completion
 *   tts       — text → speech (audio OUTPUT from text input). Distinct from
 *               `audio` (generic audio) and from `stt` (speech → text).
 *   stt       — speech → text (audio INPUT → text output)
 *   image     — image GENERATION (text/image → image output). Distinct from
 *               `vision` (image UNDERSTANDING / image INPUT).
 *   video     — video GENERATION (text/image → video output)
 *   embedding — text/multimodal → vector embedding
 *   code      — code generation / coding-specialised
 */
export interface ModelCapabilities {
  text: boolean;
  vision: boolean;
  audio: boolean;
  video: boolean;
  image: boolean;
  reasoning: boolean;
  webSearch: boolean;
  streaming: boolean;
  tools?: boolean;
  /** Text → speech generation (audio output from text input). */
  tts?: boolean;
  /** Speech → text transcription (audio input → text output). */
  stt?: boolean;
  /** Vector embedding generation. */
  embedding?: boolean;
  /** Code generation / coding-specialised. */
  code?: boolean;
}

/** Access classification (PRD §5, §6, §7, §17).
 *
 * Determined ONLY from provider metadata — never inferred from popularity,
 * openness, or "provider has free models" (PRD §7).
 *   free      — provider metadata confirms the operation costs zero
 *   paid      — provider requires payment/credits for the operation
 *   freemium  — a free allowance exists AND paid usage is also possible
 *   unknown   — pricing/access cannot be reliably established
 *
 * Free-Only mode (PRD §6) filters strictly on `access === "free"` — paid,
 * freemium, and unknown models are ALL excluded. */
export type AccessType = "free" | "paid" | "freemium" | "unknown";

/** Confidence in the metadata source (PRD §13 — provider priority). */
export type MetadataConfidence =
  | "authoritative" // provider's own API / official metadata
  | "verified" // provider's official model metadata
  | "inferred" // fallback inference (lower confidence)
  | "unknown";

/** Unified model entry (PRD §14). One entry per (source, provider, model). */
export interface UnifiedModel {
  id: string;
  displayName: string;
  source: Source;
  provider: string;
  originalModelId: string;
  capabilities: ModelCapabilities;
  streaming: boolean;
  pricing: ModelPricing;
  available: boolean;
  discoveredAt: string;
  metadata: Record<string, unknown>;
  /** Access classification (PRD §5, §6, §7). Derived ONLY from provider
   *  metadata — never inferred. Free-Only mode filters strictly on
   *  `access === "free"`; paid/freemium/unknown are all excluded. */
  access: AccessType;
  /** Human-readable reason for the access classification (for UI tooltips +
   *  debugging — e.g. "freeTier.isFree=true, pricing=Free" or
   *  "paid_only=true"). */
  accessReason?: string;
  /** Confidence in the metadata source (PRD §13). */
  metadataConfidence?: MetadataConfidence;
}

/** Provider entry (PRD §15). */
export interface UnifiedProvider {
  id: string;
  name: string;
  source: Source;
  requiresApiKey: boolean;
  supportsModelDiscovery: boolean;
  supportsStreaming: boolean;
  capabilities: string[];
  models: string[];
  lastDiscoveredAt: string;
}

/** XYZ transaction types (PRD §43). */
export type XYZTransactionType =
  | "DAILY_GRANT"
  | "GENERATION"
  | "REFUND"
  | "ADMIN_ADJUSTMENT";

export interface XYZTransaction {
  id: string;
  userId: string;
  type: XYZTransactionType;
  /** Positive for grants/refunds, negative for spending. */
  amount: number;
  balanceAfter: number;
  requestId?: string;
  source?: Source;
  provider?: string;
  model?: string;
  pricingVersion?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheTokens?: number;
  usdCost?: number;
  marketEquivalentCost?: number;
  note?: string;
  createdAt: string;
}

/** User XYZ balance state (PRD §44). */
export interface XYZBalance {
  userId: string;
  xyzBalance: number;
  lifetimeEarned: number;
  lifetimeSpent: number;
  lastDailyGrantAt?: string;
  updatedAt: string;
}

/** Usage record produced by every generation (PRD §38). */
export interface UsageRecord {
  requestId: string;
  userId: string;
  source: Source;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  usdCost: number;
  xyzCost: number;
  marketEquivalentCost?: number;
  pricingVersion: number;
  estimated?: boolean;
  timestamp: string;
}

/** User account (PRD §85). Internal id is the stable primary key. */
export interface UserAccount {
  id: string;
  email: string;
  emailVerified: boolean;
  createdAt: string;
  lastLoginAt: string;
  lastDailyGrantAt?: string;
  status: "active" | "disabled";
}

/** A pending email verification code (PRD §82). Hashed at rest. */
export interface EmailCodeRecord {
  userId: string;
  email: string;
  codeHash: string;
  expiresAt: string;
  attempts: number;
  createdAt: string;
}

/** BYOK credential metadata (PRD §54). The raw key is stored separately. */
export interface BYOKCredentialMeta {
  provider: "gratisfy" | "pollinations";
  connected: boolean;
  masked: string; // never the full key
  addedAt: string;
  lastValidatedAt?: string;
  lastValidationOk?: boolean;
}

export type BYOKProvider = "gratisfy" | "pollinations";

/** Pricing board version snapshot (PRD §30). */
export interface PricingVersion {
  version: number;
  updatedAt: string;
  source: PricingSource;
}

/** Parsed source-aware model id. */
export interface ParsedModelId {
  source: Source;
  provider: string;
  model: string;
  raw: string;
}

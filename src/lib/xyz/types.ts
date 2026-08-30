/**
 * FreeAIXYZ Unified BYOK + XYZ Credit System — core types.
 *
 * Architecture (PRD §2): SOURCE → PROVIDER → MODEL are distinct concepts.
 *   Source: native | gratisfy | g4f
 *   Provider: the underlying upstream (Google AI Studio, Gemini, OpenAI, …)
 *   Model: the actual model id
 *
 * Source-aware canonical ids (PRD §18):
 *   native:<provider>:<model>
 *   gratisfy:<provider>:<model>
 *   g4f:<provider>:<model>
 */

export type Source = "native" | "gratisfy" | "g4f" | "pollinations";

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

/** Per-model pricing (PRD §25). All values are USD per 1M tokens. */
export interface ModelPricing {
  inputPerMillion: number | null;
  outputPerMillion: number | null;
  cachePerMillion?: number | null;
  currency: "USD";
  status: PricingStatus;
  source: PricingSource;
  verifiedAt?: string;
}

/** Capabilities advertised for a model (PRD §14). */
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
}

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
  provider: "gratisfy" | "g4f" | "pollinations";
  connected: boolean;
  masked: string; // never the full key
  addedAt: string;
  lastValidatedAt?: string;
  lastValidationOk?: boolean;
}

export type BYOKProvider = "gratisfy" | "g4f" | "pollinations";

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

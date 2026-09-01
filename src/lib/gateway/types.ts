/**
 * Gateway core types (PRD §24, §46, §47, §71, §146).
 *
 * These are the canonical contracts every gateway service, provider adapter,
 * API route, and the frontend store operate on. They are independent of the
 * legacy hard-coded MODELS[] registry so the two can coexist during migration.
 */

// ─── Canonical model representation (PRD §24) ───────────────────────────────

export type ModelStatus = "active" | "degraded" | "offline" | "unknown";
export type ProviderStatus = "healthy" | "degraded" | "offline" | "unknown";
export type DiscoveryMode = "dynamic" | "manual";

export interface ModelCapabilities {
  text: boolean;
  image: boolean;
  imageEdit: boolean;
  audioInput: boolean;
  audioOutput: boolean;
  vision: boolean;
  tools: boolean;
  streaming: boolean;
}

export interface ModelMetadata {
  contextWindow?: number;
  maxOutputTokens?: number;
  source?: string;
  /** Raw upstream model object preserved verbatim (PRD §229). */
  raw?: unknown;
}

export interface DiscoveredModel {
  /** Canonical public id: `<shortProviderId>/<upstreamId>` (PRD §25). */
  id: string;
  providerId: string;
  providerName: string;
  /** Original upstream model id, never overwritten (PRD §25). */
  upstreamId: string;
  name: string;
  capabilities: ModelCapabilities;
  metadata?: ModelMetadata;
  discoveredAt: string;
  lastVerifiedAt?: string;
  status: ModelStatus;
  /** How this model was discovered (PRD §34). */
  discoveryMode: DiscoveryMode;
  /** Endpoint the model was discovered from (PRD §32). */
  discoveredFrom?: string;
  /**
   * Free-tier classification (PRD §42 — free-only catalog).
   * `true` if the model is genuinely free (no auth/payment required to call).
   * `false` for paid / PRO / premium / auth-gated models. Defaults to `true`
   * for legacy manual entries that don't carry free metadata (FreeAIXYZ is a
   * free-tier gateway — most legacy models are free by convention).
   */
  free?: boolean;
  /**
   * Confidence level of the free classification
   * (`provider` | `pattern` | `unknown`).
   */
  freeConfidence?: "provider" | "pattern" | "unknown";
  /** Human-readable reason explaining the free classification. */
  freeReason?: string;
}

// ─── Provider adapter interface (PRD §71) ───────────────────────────────────

export interface ChatRequest {
  /** Canonical public model id (`<shortProviderId>/<upstreamId>`). */
  modelId: string;
  upstreamId: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  stream: boolean;
  signal?: AbortSignal;
  temperature?: number;
  maxTokens?: number;
  /** OpenAI's newer alternative spelling for max_tokens (audit E1). */
  maxCompletionTokens?: number;
  /** nucleus sampling param (audit E1). */
  topP?: number;
  /** stop sequences (audit E1). */
  stop?: string | string[];
  /** deterministic sampling seed (audit E1). */
  seed?: number;
  /** -2.0 to 2.0 (audit E1). */
  presencePenalty?: number;
  /** -2.0 to 2.0 (audit E1). */
  frequencyPenalty?: number;
  /** number of completions to generate (audit E1). */
  n?: number;
  /** OpenAI stream options object (audit E1, E2). */
  streamOptions?: { include_usage?: boolean };
  /** OpenAI tools array — preserved through every transformation layer (Tool PRD §5). */
  tools?: unknown[];
  /** tool_choice — string OR forced-function object form (Tool PRD §9). */
  toolChoice?: string | { type: "function"; function: { name: string } };
  /** parallel_tool_calls — forwarded when explicitly set (Tool PRD §5). */
  parallelToolCalls?: boolean;
}

export interface ImageRequest {
  modelId: string;
  upstreamId: string;
  prompt: string;
  size?: string;
  n?: number;
  signal?: AbortSignal;
}

export interface HealthResult {
  status: ProviderStatus;
  latencyMs?: number;
  lastChecked: string;
  successRate?: number;
  errorRate?: number;
  activeModels?: number;
  /** Stable short id for this provider (PRD §26). */
  providerId: string;
  message?: string;
}

export interface DiscoveryResult {
  providerId: string;
  models: DiscoveredModel[];
  mode: DiscoveryMode;
  startedAt: string;
  finishedAt: string;
  modelsFound: number;
  modelsAdded: number;
  modelsRemoved: number;
  error?: string;
  /** Endpoint hit, if dynamic (PRD §32). */
  endpoint?: string;
}

/**
 * Standardized provider adapter (PRD §71). The gateway calls these methods;
 * adapters normalize provider-specific behavior into the canonical contract.
 */
export interface ProviderAdapter {
  id: string;
  /** Short stable id used in canonical model ids (PRD §26). */
  shortId: string;
  name: string;
  baseUrl?: string;
  discoveryMode: DiscoveryMode;

  discoverModels?(): Promise<DiscoveredModel[]>;
  healthCheck?(): Promise<HealthResult>;

  /** Non-streaming chat completion → full text. */
  complete(req: ChatRequest): Promise<{ text: string }>;
  /**
   * Streaming chat completion → async generator of incremental text deltas.
   * MUST yield genuine upstream deltas as they arrive (PRD §10, §137).
   * MUST NOT buffer the full response and re-pace it (PRD §137).
   */
  stream(req: ChatRequest): AsyncGenerator<string, void, unknown>;

  generateImage?(req: ImageRequest): Promise<{ url?: string; b64?: string }>;
}

// ─── Streaming instrumentation (PRED §6) ───────────────────────────────────

export interface StreamTimings {
  requestId: string;
  requestStart: number;
  upstreamRequestStart?: number;
  upstreamHeadersReceived?: number;
  upstreamFirstChunk?: number;
  proxyFirstForward?: number;
  clientFirstChunk?: number;
  firstUIUpdate?: number;
  /** Time-to-first-byte (proxy → client). */
  ttfbMs?: number;
  /** Time-to-first-token (request → first upstream chunk forwarded). */
  ttftMs?: number;
  proxyLatencyMs?: number;
  clientLatencyMs?: number;
  totalDurationMs?: number;
  chunkCount: number;
  bytes: number;
  providerId?: string;
  modelId?: string;
  streamRequested: boolean;
  upstreamStatus?: number;
  contentType?: string;
  error?: string;
}

// ─── API metrics (PRD §115-117) ─────────────────────────────────────────────

export interface ApiMetrics {
  requests: number;
  successRate: number;
  errors: number;
  streamingRequests: number;
  averageTtftMs: number;
  averageLatencyMs: number;
  providerFailures: Record<string, number>;
  recentErrors: Array<{
    requestId: string;
    providerId?: string;
    modelId?: string;
    status: number;
    type: string;
    message: string;
    at: string;
  }>;
}

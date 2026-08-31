/**
 * Gateway public surface (barrel).
 *
 * Re-exports the singletons + key types + sse-parser + errors + ids + redact
 * so the API routes (Phase 3a) and frontend store (Phase 4) can import from
 * a single entry point: `@/lib/gateway`.
 *
 * Singletons:
 *   - catalogStore          — model catalog + provider/model health cache
 *   - providerRegistry      — adapter registry (legacy + dynamic)
 *   - providerHealthService — circuit breaker + provider/model health
 *   - streamingProxyService — streamChat() (the streaming fix)
 *   - metricsService        — rolling 1000-request ring buffer
 *   - initGateway           — idempotent startup
 *   - isGatewayReady()      — startup check
 *
 * Helpers:
 *   - streamChat(req, adapter)   — functional entry-point
 *   - STREAM_HEADERS             — SSE response headers (PRD §11, §12)
 *   - buildLegacyAdapters()      — wrap legacy MODELS[] into ProviderAdapter[]
 *   - getLegacyProvider(id)      — get the legacy Provider instance
 */

// Types (PRD §24).
export type {
  ApiMetrics,
  ChatRequest,
  DiscoveryMode,
  DiscoveryResult,
  DiscoveredModel,
  HealthResult,
  ImageRequest,
  ModelCapabilities,
  ModelMetadata,
  ModelStatus,
  ProviderAdapter,
  ProviderStatus,
  StreamTimings,
} from "@/lib/gateway/types";

// Errors (PRD §62, §146-149, R-1..R-13).
export {
  classifyUpstreamStatus,
  defaultStatusFor,
  emptyContentError,
  emptyUpstreamResponseError,
  errorResponse,
  generateRequestId,
  GatewayError,
  hasNonEmptyContent,
  isFailoverCandidate,
  isRetryableStatus,
  isRetryableType,
  sanitizeUpstreamMessage,
  sseErrorEvent,
  sseTerminalErrorChunk,
} from "@/lib/gateway/errors";
export type { GatewayErrorBody, GatewayErrorType } from "@/lib/gateway/errors";

// Ids (PRD §23, §25, §26).
export {
  canonicalModelId,
  getByShortId,
  getProviderEntry,
  listProviderEntries,
  parseCanonicalModelId,
  PROVIDER_SHORT_IDS,
  shortIdFor,
} from "@/lib/gateway/ids";
export type { ProviderShortIdEntry } from "@/lib/gateway/ids";

// Redactor (PRD §126, §209, §210).
export {
  bodyPreview,
  redactHeader,
  redactHeaders,
  redactText,
  safeResponseHeaders,
  sanitizeOutboundHeaders,
} from "@/lib/gateway/redact";

// SSE parser (PRD §17-20).
export {
  extractOpenAiDelta,
  extractSseError,
  isFinishEvent,
  SseParser,
} from "@/lib/gateway/sse-parser";
export type { SseEvent } from "@/lib/gateway/sse-parser";

// Services (PRD §6, §27-39, §46-48, §115-117, §141, §200).
export {
  buildLegacyAdapters,
  buildLegacyDiscoveredModels,
  getLegacyProvider,
} from "@/lib/gateway/adapters/legacy";
export { catalogStore } from "@/lib/gateway/catalog";
export type { ModelHealthEntry } from "@/lib/gateway/catalog";
export { providerRegistry } from "@/lib/gateway/registry";
export type { DynamicDiscoverer } from "@/lib/gateway/registry";
export { providerHealthService } from "@/lib/gateway/health";
export {
  STREAM_HEADERS,
  streamChat,
  streamingProxyService,
} from "@/lib/gateway/streaming-proxy";
export type { FailoverCandidate } from "@/lib/gateway/streaming-proxy";
export { metricsService } from "@/lib/gateway/metrics";
export type { RequestMetric } from "@/lib/gateway/metrics";
export { initGateway, isGatewayReady } from "@/lib/gateway/startup";

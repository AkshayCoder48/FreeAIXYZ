/**
 * FreeAIXYZ Unified BYOK + auth — public barrel.
 *
 * Server-only. The BYOK keys + auth + crypto NEVER touch the browser
 * bundle.
 *
 * Persistence (this iteration):
 *   - Auth (users + sessions): OnyxBase KV store (no Prisma).
 *   - BYOK credentials: OnyxBase KV store, keyed by the authenticated
 *     userId (NOT a browser-local UUID). Saved keys persist across refresh
 *     / tab changes / devices because they live with the account,
 *     server-side.
 *   - Model discovery: NO persistence AND NO in-memory caching (per user
 *     request — "remove caching of catalog make it fetch all time on all
 *     app open"). Every `getUnifiedModels` call hits the live upstream.
 */

export * from "./types";
export * from "./pricing-board";
export * from "./credit";
export * from "./byok";
export * from "./crypto";
export * from "./auth";
export * from "./api-keys";
export * from "./openai-chat";
export * from "./gratisfy";
export * from "./pollinations";
export * from "./registry";
export * from "./onyxbase";

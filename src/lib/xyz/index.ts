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
 *   - Model discovery: NO persistence — fetched fresh from upstream on
 *     every app open (30s in-memory cache only).
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
export * from "./g4f";
export * from "./pollinations";
export * from "./registry";
export * from "./onyxbase";

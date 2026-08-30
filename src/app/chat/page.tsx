/**
 * /chat — Live Models Playground (W4-F, PRD §53, §54, §77).
 *
 * RSC. Server-side auth + parallel fetch of the unified model catalog, the
 * user's BYOK connection state, and the XYZ→USD multiplier. Serializes a
 * JSON-safe `ChatPlaygroundData` shape to the client island, which owns the
 * interactive chat surface (state machine, SSE streaming, markdown render).
 *
 * Auth is OPTIONAL here — anonymous users land on native models. Picking a
 * BYOK (`gratisfy:*` / `g4f:*`) model surfaces a "Sign in" or "Configure"
 * prompt rather than bouncing them off the page.
 */

import type { Metadata } from "next";
import { cookies, headers } from "next/headers";

import { Nav } from "@/components/nav";
import { SectionLabel, SiteFooter, FadeIn } from "@/components/site";
import {
  ChatPlaygroundClient,
  type ChatPlaygroundData,
} from "@/components/playground/chat-playground-client";
import {
  getUnifiedModels,
  getBYOKMeta,
  getAccount,
  getSessionUserId,
  XYZ_USD_MULTIPLIER,
  type UnifiedModel,
  type UnifiedProvider,
  type BYOKCredentialMeta,
  type BYOKProvider,
  type UserAccount,
} from "@/lib/xyz";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Chat Playground — FreeAIXYZ",
  description:
    "Streaming chat playground with live models from /api/v1/models/unified. Real SSE deltas, BYOK-aware routing, XYZ cost tracking.",
};

// Empty record so the client always has a defined shape for both BYOK
// providers (matches the Settings page's pattern).
const EMPTY_BYOK: Record<BYOKProvider, BYOKCredentialMeta> = {
  gratisfy: { provider: "gratisfy", connected: false, masked: "", addedAt: "" },
  g4f: { provider: "g4f", connected: false, masked: "", addedAt: "" },
};

export default async function ChatPage() {
  // Resolve the session server-side (RSC) — same pattern as /settings + /pricing.
  // Best-effort; failures degrade to safe defaults rather than crashing the
  // page (PRD §25 — graceful degradation).
  const headerStore = await headers();
  const cookieStore = await cookies();
  const url = headerStore.get("x-url") || "http://localhost:3000/chat";
  const request = new Request(url, {
    headers: { cookie: cookieStore.toString() },
  });
  const userId = await getSessionUserId(request);

  // Parallel fetch — everything the playground needs is resolved at request
  // time so the user lands on a fully populated catalog.
  const [unifiedRes, byokRes, accountRes] = await Promise.all([
    getUnifiedModels(userId ?? undefined).catch(() => ({
      models: [] as UnifiedModel[],
      providers: [] as UnifiedProvider[],
      stale: false,
    })),
    userId
      ? getBYOKMeta(userId).catch(() => EMPTY_BYOK)
      : Promise.resolve(EMPTY_BYOK),
    userId
      ? getAccount(userId).catch(() => null as UserAccount | null)
      : Promise.resolve(null as UserAccount | null),
  ]);

  const byok: Record<BYOKProvider, BYOKCredentialMeta> = byokRes ?? EMPTY_BYOK;

  // Serialize the account to a plain JSON-safe shape (no Date objects, no
  // undefined — RSCs only pass serializable props to client components).
  // NOTE: `getAccount()` returns the public subset of UserAccount (omits
  // `status`), so we don't propagate it here either.
  const user: {
    id: string;
    email: string;
    emailVerified: boolean;
    createdAt: string;
    lastLoginAt: string;
  } | null = accountRes
    ? {
        id: accountRes.id,
        email: accountRes.email,
        emailVerified: accountRes.emailVerified,
        createdAt: accountRes.createdAt,
        lastLoginAt: accountRes.lastLoginAt,
      }
    : null;

  // Serialize the unified model catalog to a plain JSON shape. Filter to
  // currently-available models so the dropdown never offers a dead entry.
  const models = unifiedRes.models
    .filter((m) => m.available)
    .map((m) => ({
      id: m.id,
      source: m.source,
      provider: m.provider,
      displayName: m.displayName,
      originalModelId: m.originalModelId,
      streaming: m.streaming,
      available: m.available,
      capabilities: m.capabilities,
      pricing: m.pricing,
    }));

  const data: ChatPlaygroundData = {
    models,
    byok,
    user,
    multiplier: XYZ_USD_MULTIPLIER || 1,
    catalogStale: unifiedRes.stale,
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Nav />
      <main className="flex-1 mx-auto max-w-7xl w-full px-4 sm:px-6 py-8 sm:py-12 min-w-0 flex flex-col gap-6 min-h-0">
        <FadeIn className="flex flex-col gap-3">
          <SectionLabel dotColor="var(--chart-2, #10b981)">Chat playground</SectionLabel>
          <h1 className="text-4xl sm:text-5xl font-normal tracking-tight text-foreground mt-2">
            Send a message. Watch it{" "}
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-emerald-600 to-emerald-400">
              stream
            </span>
            .
          </h1>
          <p className="text-sm text-muted-foreground max-w-3xl leading-relaxed">
            Live models from{" "}
            <code
              className="font-mono text-[11px] text-foreground/80 bg-muted px-1.5 py-0.5 rounded"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >
              /api/v1/models/unified
            </code>
            . Real SSE deltas — no buffering, no re-pacing. BYOK-aware routing
            with inline XYZ cost tracking.
          </p>
        </FadeIn>
        <ChatPlaygroundClient data={data} />
      </main>
      <SiteFooter>
        <span
          className="font-mono"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          POST /api/v1/chat/completions · stream:true
        </span>
        <span
          className="font-mono"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          GET /api/v1/models/unified
        </span>
      </SiteFooter>
    </div>
  );
}

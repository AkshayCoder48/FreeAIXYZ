import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { Nav } from "@/components/nav";
import { SiteFooter } from "@/components/site";
import {
  SettingsClient,
  type SettingsData,
  type SettingsUser,
} from "@/components/settings/settings-client";
import {
  getBYOKMeta,
  listApiKeys,
  getAccount,
  getBalance,
  getTransactions,
  getUsage,
  getUnifiedModels,
  getSessionUserId,
  type BYOKCredentialMeta,
  type ApiKeyInfo,
  type XYZBalance,
  type XYZTransaction,
  type UsageRecord,
  type UnifiedProvider,
  type BYOKProvider,
} from "@/lib/xyz";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Settings — FreeAIXYZ",
  description:
    "Manage your account, BYOK keys, API keys, XYZ usage, theme preferences, and live provider diagnostics.",
};

// Empty record so the client always has a defined shape for both BYOK providers.
const EMPTY_BYOK: Record<BYOKProvider, BYOKCredentialMeta> = {
  gratisfy: { provider: "gratisfy", connected: false, masked: "", addedAt: "" },
  g4f: { provider: "g4f", connected: false, masked: "", addedAt: "" },
};

export default async function SettingsPage() {
  // Resolve the session server-side (RSC) — same pattern as /pricing.
  const headerStore = await headers();
  const cookieStore = await cookies();
  const url = headerStore.get("x-url") || "http://localhost:3000/settings";
  const request = new Request(url, {
    headers: { cookie: cookieStore.toString() },
  });
  const userId = await getSessionUserId(request);

  // Not authed → render the page chrome + a sign-in card. (We don't redirect
  // because the user clicked a nav link expecting to land here; showing a
  // sign-in card right where they expected is friendlier than bouncing home.)
  if (!userId) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Nav />
        <main className="flex-1 mx-auto max-w-3xl w-full px-4 sm:px-6 py-8 sm:py-12 flex items-center justify-center min-w-0">
          <SettingsClient data={null} user={null} />
        </main>
        <SiteFooter />
      </div>
    );
  }

  // Authed — parallel fetch everything we need server-side. Each fetch is
  // best-effort; failures degrade to safe defaults rather than crashing the
  // page (PRD §25 — graceful degradation).
  const [
    byokRes,
    apiKeysRes,
    accountRes,
    balanceRes,
    transactionsRes,
    usageRes,
    unifiedRes,
  ] = await Promise.all([
    getBYOKMeta(userId).catch(() => null),
    listApiKeys(userId).catch(() => [] as ApiKeyInfo[]),
    getAccount(userId).catch(() => null),
    getBalance(userId).catch(() => null),
    getTransactions(userId, 50).catch(() => [] as XYZTransaction[]),
    getUsage(userId, 50).catch(() => [] as UsageRecord[]),
    getUnifiedModels(userId).catch(() => ({
      models: [],
      providers: [] as UnifiedProvider[],
      stale: false,
    })),
  ]);

  // The BYOK meta is a Record; if null we fall back to the empty shape so the
  // client always knows both providers exist as keys.
  const byok: Record<BYOKProvider, BYOKCredentialMeta> =
    byokRes ?? EMPTY_BYOK;

  const user: SettingsUser | null = accountRes
    ? {
        id: accountRes.id,
        email: accountRes.email,
        emailVerified: accountRes.emailVerified,
        createdAt: accountRes.createdAt,
        lastLoginAt: accountRes.lastLoginAt,
      }
    : null;

  // Serialize to a plain JSON-safe shape (RSCs can only pass serializable
  // props to client components — Date objects, BigInts, etc. must be
  // stringified first).
  const data: SettingsData = {
    byok,
    apiKeys: apiKeysRes,
    balance: balanceRes
      ? {
          xyzBalance: balanceRes.xyzBalance,
          lifetimeEarned: balanceRes.lifetimeEarned,
          lifetimeSpent: balanceRes.lifetimeSpent,
          lastDailyGrantAt: balanceRes.lastDailyGrantAt,
          updatedAt: balanceRes.updatedAt,
        }
      : null,
    transactions: transactionsRes.map((t) => ({
      id: t.id,
      type: t.type,
      amount: t.amount,
      balanceAfter: t.balanceAfter,
      requestId: t.requestId,
      source: t.source,
      provider: t.provider,
      model: t.model,
      note: t.note,
      createdAt: t.createdAt,
    })),
    usage: usageRes.map((u) => ({
      requestId: u.requestId,
      source: u.source,
      provider: u.provider,
      model: u.model,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      cacheTokens: u.cacheTokens,
      usdCost: u.usdCost,
      xyzCost: u.xyzCost,
      pricingVersion: u.pricingVersion,
      timestamp: u.timestamp,
    })),
    providers: unifiedRes.providers.map((p) => ({
      id: p.id,
      name: p.name,
      source: p.source,
      requiresApiKey: p.requiresApiKey,
      supportsModelDiscovery: p.supportsModelDiscovery,
      modelCount: p.models.length,
      lastDiscoveredAt: p.lastDiscoveredAt,
    })),
    unifiedModelsCount: unifiedRes.models.length,
    catalogStale: unifiedRes.stale,
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Nav />
      <main className="flex-1 mx-auto max-w-7xl w-full px-4 sm:px-6 py-8 sm:py-12 min-w-0 flex flex-col gap-6 min-h-0">
        <SettingsClient data={data} user={user} />
      </main>
      <SiteFooter />
    </div>
  );
}

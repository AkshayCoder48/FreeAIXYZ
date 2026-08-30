"use client";

/**
 * ByokProviders — BYOK management surface.
 *
 * GATED BEHIND SIGN-IN: API key inputs are only shown after the user
 * signs in (direct email login — no verification code). Saved keys live
 * in OnyxBase keyed by the authenticated userId, so they persist across
 * refresh / tab changes / devices.
 *
 * On mount (when signed in) we fetch GET /api/v1/byok to load the masked
 * metadata for every saved key — this is the fix for "key getting deleted
 * after tab change or refresh": the key is never in localStorage, it lives
 * server-side with the account.
 *
 * Three cards: Gratisfy, G4F, Pollinations. Each card:
 *   - Input (password) + Save (POST /api/v1/byok/<src>)
 *   - Test  (POST /api/v1/byok/<src>/test) — shows "{count} models visible"
 *   - Remove(DELETE /api/v1/byok/<src>)
 *
 * ERROR HANDLING: server returns `{ error: { type, code, message } }` on
 * failure. We always extract `.message` before passing to toast — never
 * render the error object directly as a React child.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  RefreshCw,
  KeyRound,
  Trash2,
  CheckCircle2,
  XCircle,
  LogIn,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type ByokSource = "gratisfy" | "g4f" | "pollinations";

interface SaveMeta {
  provider: string;
  connected: boolean;
  masked: string;
  addedAt: string;
  lastValidatedAt?: string;
  lastValidationOk?: boolean;
}

type ByokMetaMap = Record<ByokSource, SaveMeta>;

interface SaveResponse {
  ok: boolean;
  meta?: SaveMeta;
  error?: string | { type?: string; code?: string; message?: string };
}

interface TestResponse {
  ok: boolean;
  error?: string | { type?: string; code?: string; message?: string };
  count?: number;
  modelCount?: number;
}

interface ProviderEntry {
  id: string;
  name: string;
  source: "native" | "gratisfy" | "g4f";
  requiresApiKey: boolean;
  supportsModelDiscovery: boolean;
  supportsStreaming: boolean;
  capabilities: string[];
  modelCount: number;
  lastDiscoveredAt: string;
}

interface ProvidersResponse {
  providers: ProviderEntry[];
  stale: boolean;
}

/** Extract a string message from an error response. */
function errorMessage(err: unknown, fallback: string): string {
  if (typeof err === "string") return err || fallback;
  if (err && typeof err === "object") {
    const e = err as { message?: string; code?: string; type?: string };
    return e.message || e.code || e.type || fallback;
  }
  return fallback;
}

const PROVIDER_LABEL: Record<ByokSource, string> = {
  gratisfy: "Gratisfy",
  g4f: "G4F",
  pollinations: "Pollinations",
};

const PROVIDER_PLACEHOLDER: Record<ByokSource, string> = {
  gratisfy: "gxyz-…",
  g4f: "g4f_…",
  pollinations: "your Pollinations token",
};

const PROVIDER_DESC: Record<ByokSource, string> = {
  gratisfy: "Bring your own gxyz-… key from Gratisfy. Stored encrypted in OnyxBase.",
  g4f: "Bring your own g4f_… key from g4f.dev. Stored encrypted in OnyxBase.",
  pollinations:
    "Bring your own Pollinations token. Stored encrypted in OnyxBase.",
};

function SourceBadge({ source }: { source: ProviderEntry["source"] }) {
  const label = source.toUpperCase();
  const className =
    source === "gratisfy"
      ? "border-transparent bg-violet-500/15 text-violet-700 dark:text-violet-300"
      : source === "g4f"
        ? "border-transparent bg-orange-500/15 text-orange-700 dark:text-orange-300"
        : "border-transparent bg-slate-500/15 text-slate-700 dark:text-slate-300";
  return <Badge className={className}>{label}</Badge>;
}

interface ByokCardProps {
  source: ByokSource;
  meta: SaveMeta | null;
  onMutated: () => void;
}

function ByokCard({ source, meta, onMutated }: ByokCardProps) {
  const label = PROVIDER_LABEL[source];
  const base = `/api/v1/byok/${source}`;
  const testEndpoint = `${base}/test`;

  const [keyInput, setKeyInput] = useState("");
  const [masked, setMasked] = useState<string | null>(meta?.masked ?? null);
  const [connected, setConnected] = useState<boolean | null>(
    meta ? meta.connected : null,
  );
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [removing, setRemoving] = useState(false);

  // Sync local state when the parent refetches meta (e.g. after refresh).
  useEffect(() => {
    if (meta) {
      setMasked(meta.masked || null);
      setConnected(meta.connected);
    } else {
      setMasked(null);
      setConnected(null);
    }
  }, [meta]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = keyInput.trim();
    if (!trimmed) {
      toast.error("Paste a key first");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(base, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: trimmed }),
      });
      const data: SaveResponse = await res.json();
      if (res.ok && data.ok && data.meta) {
        setMasked(data.meta.masked);
        setConnected(data.meta.connected);
        setKeyInput("");
        toast.success(`${label} key saved (masked: ${data.meta.masked})`);
        onMutated();
      } else {
        toast.error(errorMessage(data.error, `Failed to save ${label} key`));
      }
    } catch {
      toast.error("Network error — try again");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    try {
      const res = await fetch(testEndpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(keyInput.trim() ? { key: keyInput.trim() } : {}),
      });
      const data: TestResponse = await res.json();
      if (res.ok && data.ok) {
        setConnected(true);
        const count = typeof data.count === "number" ? data.count : data.modelCount;
        if (typeof count === "number") {
          toast.success(`${count} models visible`);
        } else {
          toast.success(`${label} key valid`);
        }
        onMutated();
      } else {
        setConnected(false);
        toast.error(errorMessage(data.error, `${label} key invalid`));
      }
    } catch {
      toast.error("Network error — try again");
    } finally {
      setTesting(false);
    }
  }

  async function handleRemove() {
    setRemoving(true);
    try {
      const res = await fetch(base, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        setMasked(null);
        setConnected(false);
        setKeyInput("");
        toast.success(`${label} key removed`);
        onMutated();
      } else {
        toast.error(`Failed to remove ${label} key`);
      }
    } catch {
      toast.error("Network error — try again");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2 flex-wrap">
          <CardTitle className="text-base">{label}</CardTitle>
          <Badge className="border-transparent bg-violet-500/15 text-violet-700 dark:text-violet-300">
            BYOK
          </Badge>
          {connected === true ? (
            <Badge className="border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-3 w-3" /> Connected
            </Badge>
          ) : connected === false ? (
            <Badge className="border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-300">
              <XCircle className="h-3 w-3" /> Not connected
            </Badge>
          ) : null}
        </div>
        <CardDescription>{PROVIDER_DESC[source]}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {masked && (
          <div className="text-xs text-muted-foreground">
            Stored key:{" "}
            <span className="font-mono text-foreground">{masked}</span>
          </div>
        )}
        <form onSubmit={handleSave} className="flex flex-col gap-2">
          <Label htmlFor={`byok-${source}-key`} className="text-xs">
            {label} API key
          </Label>
          <Input
            id={`byok-${source}-key`}
            type="password"
            autoComplete="off"
            placeholder={PROVIDER_PLACEHOLDER[source]}
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            disabled={saving}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={saving}>
              <KeyRound className="h-4 w-4" />
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleTest}
              disabled={testing || (!masked && !keyInput.trim())}
            >
              {testing ? "Testing…" : "Test"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleRemove}
              disabled={removing || !masked}
            >
              <Trash2 className="h-4 w-4" />
              {removing ? "Removing…" : "Remove"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function ByokProviders() {
  const { user, loading: authLoading } = useAuth();
  const [meta, setMeta] = useState<ByokMetaMap | null>(null);
  const [providers, setProviders] = useState<ProviderEntry[] | null>(null);
  const [stale, setStale] = useState(false);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Load saved (masked) BYOK keys on mount — the fix for "key deleted on
  // refresh": keys live in OnyxBase keyed by userId, fetched fresh here.
  const loadMeta = useCallback(async () => {
    if (!user) return;
    setLoadingMeta(true);
    try {
      const res = await fetch("/api/v1/byok", {
        credentials: "include",
        cache: "no-store",
      });
      if (res.ok) {
        const data = (await res.json()) as { ok: boolean; meta: ByokMetaMap };
        if (data.meta) setMeta(data.meta);
      }
    } catch {
      // ignore — meta stays null
    } finally {
      setLoadingMeta(false);
    }
  }, [user]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/v1/providers", {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) {
        toast.error("Failed to fetch providers");
        return;
      }
      const data: ProvidersResponse = await res.json();
      setProviders(data.providers);
      setStale(Boolean(data.stale));
      toast.success(`Discovered ${data.providers.length} providers`);
    } catch {
      toast.error("Network error — try again");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Loading state while auth resolves.
  if (authLoading) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Providers</h1>
          <p className="text-sm text-muted-foreground mt-1">Loading…</p>
        </div>
      </div>
    );
  }

  // NOT signed in — gate BYOK input behind sign-in.
  if (!user) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Providers</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Sign in to manage your BYOK API keys.
          </p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <LogIn className="h-4 w-4" /> Sign in required
            </CardTitle>
            <CardDescription>
              BYOK API key inputs are only available after you sign in. Your
              keys are saved to your account and persist across refresh and
              devices. Sign in with just your email — no password, no
              verification code.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <a href="/" className="flex items-center gap-2">
                <LogIn className="h-4 w-4" /> Go sign in
              </a>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Providers</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Signed in as{" "}
            <span className="font-medium text-foreground">{user.email}</span>.
            Keys are stored in OnyxBase with your account.
          </p>
        </div>
        <Button onClick={refresh} disabled={refreshing} variant="outline">
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Refreshing…" : "Refresh Models"}
        </Button>
      </div>

      <Separator />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ByokCard
          source="gratisfy"
          meta={meta?.gratisfy ?? null}
          onMutated={loadMeta}
        />
        <ByokCard source="g4f" meta={meta?.g4f ?? null} onMutated={loadMeta} />
        <ByokCard
          source="pollinations"
          meta={meta?.pollinations ?? null}
          onMutated={loadMeta}
        />
      </div>

      <Separator />

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Unified catalog</h2>
        <p className="text-xs text-muted-foreground">
          {loadingMeta
            ? "Loading providers…"
            : providers
              ? `Showing ${providers.length} providers${stale ? " (catalog stale)" : ""}.`
              : "No providers loaded."}
        </p>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>BYOK</TableHead>
                <TableHead className="text-right">Models</TableHead>
                <TableHead>Discovered</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {providers?.slice(0, 100).map((p) => (
                <TableRow key={`${p.source}:${p.id}`}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell>
                    <SourceBadge source={p.source} />
                  </TableCell>
                  <TableCell>
                    {p.requiresApiKey ? (
                      <Badge
                        variant="outline"
                        className="text-[10px] uppercase tracking-wider"
                      >
                        BYOK
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {p.modelCount}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {p.lastDiscoveredAt
                      ? new Date(p.lastDiscoveredAt).toLocaleString()
                      : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {providers && providers.length > 100 && (
          <p className="text-xs text-muted-foreground">
            Showing 100 of {providers.length} providers — narrow via the API
            for the full list.
          </p>
        )}
      </div>
    </div>
  );
}

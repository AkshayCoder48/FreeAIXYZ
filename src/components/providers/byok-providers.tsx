"use client";

/**
 * ByokProviders — BYOK + API-key management surface (PRIVACY-MODE).
 *
 * PRIVACY-MODE BYOK (2026-08-30):
 *   The user's private BYOK credentials (Gratisfy gxyz-…, Pollinations
 *   token) live in their browser localStorage. They are NEVER sent to
 *   the server for persistence. The server only validates them on a
 *   one-shot POST /api/v1/byok/<provider> call (returns masked metadata
 *   + validation result), and the client immediately writes the key to
 *   localStorage + surfaces the connected state in the UI.
 *
 *   OAuth "Connect wallet" flow (Pollinations only): the /connect
 *   callback stashes the token in a 60s-TTL KV entry under a single-use
 *   opaque key. The browser reads ?redeem=<opaque> from the redirect
 *   URL, fetches GET /api/v1/byok/pollinations/redeem?k=<opaque> (which
 *   returns + deletes the stashed token), and writes the token to
 *   localStorage. The server never persists the token past the 60s
 *   window — even a server compromise cannot leak the user's Pollinations
 *   token once the redemption completes.
 *
 * FreeAIXYZ API keys (`fx_live_*`) are SEPARATE — those ARE persisted
 *   server-side (hashed at rest with sha256). They're the user's gateway
 *   credentials for programmatic API access (curl/SDK). The full key is
 *   returned to the client ONCE at creation time + never again. See the
 *   ApiKeysPanel below.
 *
 * Two cards (Gratisfy, Pollinations):
 *   - Input (password) + Save (POST /api/v1/byok/<src>) — validates and
 *     returns masked metadata; the actual key is written to localStorage
 *     on the client.
 *   - Test (POST /api/v1/byok/<src>/test) — re-validates against upstream.
 *   - Remove — deletes from localStorage (no server call).
 *
 * ERROR HANDLING: server returns `{ error: { type, code, message } }` on
 * failure. We always extract `.message` before passing to toast — never
 * render the error object directly as a React child.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  RefreshCw,
  KeyRound,
  Trash2,
  CheckCircle2,
  XCircle,
  LogIn,
  Wallet,
  Search,
  Boxes,
  Cpu,
  Copy,
  Plus,
  Eye,
  EyeOff,
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

// ─── Types ──────────────────────────────────────────────────────────────────

type ByokSource = "gratisfy" | "pollinations";

interface SaveMeta {
  provider: string;
  connected: boolean;
  masked: string;
  addedAt: string;
  lastValidatedAt?: string;
  lastValidationOk?: boolean;
}

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
  source: "native" | "gratisfy" | "pollinations";
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

// FreeAIXYZ API keys (server-persisted, hashed at rest).
interface ApiKeyInfo {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}
interface CreatedApiKey extends ApiKeyInfo {
  key: string;
}

// ─── localStorage helpers ────────────────────────────────────────────────────

const STORAGE_KEY = "fxz:byok";

interface StoredByok {
  // We store the raw key + the masked metadata returned from the server
  // after the last successful validation. The raw key is needed for the
  // chat completions request header (X-Gratisfy-API-Key / X-Pollinations-API-Key).
  // The masked form is what the UI surfaces.
  raw: string;
  masked: string;
  addedAt: string;
  lastValidatedAt?: string;
  lastValidationOk?: boolean;
}

function loadStored(): Record<ByokSource, StoredByok | null> {
  if (typeof window === "undefined") {
    return { gratisfy: null, pollinations: null };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { gratisfy: null, pollinations: null };
    const parsed = JSON.parse(raw) as Partial<Record<ByokSource, StoredByok>>;
    return {
      gratisfy: parsed.gratisfy ?? null,
      pollinations: parsed.pollinations ?? null,
    };
  } catch {
    return { gratisfy: null, pollinations: null };
  }
}

function saveStored(map: Record<ByokSource, StoredByok | null>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // localStorage may be full or disabled — fail silently. The chat
    // playground will just see no BYOK key (the user has to re-enter it).
  }
}

function updateStoredEntry(source: ByokSource, entry: StoredByok | null) {
  const cur = loadStored();
  cur[source] = entry;
  saveStored(cur);
}

// ─── helpers ─────────────────────────────────────────────────────────────────

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
  pollinations: "Pollinations",
};

const PROVIDER_PLACEHOLDER: Record<ByokSource, string> = {
  gratisfy: "gxyz-…",
  pollinations: "your Pollinations token",
};

const PROVIDER_DESC: Record<ByokSource, string> = {
  gratisfy:
    "Bring your own gxyz-… key from Gratisfy. Stored only in your browser (localStorage) — never on our server.",
  pollinations:
    "Bring your own Pollinations token, or click Connect wallet to sign in with Pollinations and we'll fetch one for you. Stored only in your browser (localStorage).",
};

function SourceBadge({ source }: { source: ProviderEntry["source"] }) {
  const label = source.toUpperCase();
  const className =
    source === "gratisfy"
      ? "border-transparent bg-violet-500/15 text-violet-700 dark:text-violet-300"
      : source === "pollinations"
        ? "border-transparent bg-rose-500/15 text-rose-700 dark:text-rose-300"
        : "border-transparent bg-slate-500/15 text-slate-700 dark:text-slate-300";
  return <Badge className={className}>{label}</Badge>;
}

// ─── BYOK card ───────────────────────────────────────────────────────────────

interface ByokCardProps {
  source: ByokSource;
  stored: StoredByok | null;
  onMutated: () => void;
}

function ByokCard({ source, stored, onMutated }: ByokCardProps) {
  const label = PROVIDER_LABEL[source];
  const base = `/api/v1/byok/${source}`;
  const testEndpoint = `${base}/test`;

  const [keyInput, setKeyInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [showKey, setShowKey] = useState(false);

  // Sync local display state when stored changes (e.g. after OAuth
  // redemption, after refresh).
  useEffect(() => {
    setKeyInput("");
  }, [stored]);

  const masked = stored?.masked ?? null;
  const connected = stored?.connected ?? false;
  const addedAt = stored?.addedAt ?? "";
  const lastValidatedAt = stored?.lastValidatedAt ?? "";

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
        // PRIVACY-MODE: write the key to localStorage on the client.
        // The server only validated it.
        updateStoredEntry(source, {
          raw: trimmed,
          masked: data.meta.masked,
          addedAt: data.meta.addedAt,
          lastValidatedAt: data.meta.lastValidatedAt ?? new Date().toISOString(),
          lastValidationOk: data.meta.lastValidationOk ?? true,
        });
        setKeyInput("");
        toast.success(`${label} key saved (in your browser only)`);
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
      // Test against either the input (if present) or the stored key.
      const raw = keyInput.trim() || stored?.raw || "";
      if (!raw) {
        toast.error("No key to test");
        return;
      }
      const res = await fetch(testEndpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: raw }),
      });
      const data: TestResponse = await res.json();
      if (res.ok && data.ok) {
        const count = typeof data.count === "number" ? data.count : data.modelCount;
        if (typeof count === "number") {
          toast.success(`${count} models visible`);
        } else {
          toast.success(`${label} key valid`);
        }
        // Update validation timestamp on the stored entry (if it's the same key).
        if (stored && raw === stored.raw) {
          updateStoredEntry(source, {
            ...stored,
            lastValidatedAt: new Date().toISOString(),
            lastValidationOk: true,
          });
        }
        onMutated();
      } else {
        toast.error(errorMessage(data.error, `${label} key invalid`));
      }
    } catch {
      toast.error("Network error — try again");
    } finally {
      setTesting(false);
    }
  }

  function handleRemove() {
    setRemoving(true);
    try {
      // PRIVACY-MODE: delete from localStorage only — no server call.
      updateStoredEntry(source, null);
      setKeyInput("");
      toast.success(`${label} key removed (from your browser)`);
      onMutated();
    } finally {
      setRemoving(false);
    }
  }

  /**
   * PKCE OAuth connect flow for the "Connect wallet" button (Pollinations
   * only). Generates a code_verifier + code_challenge (S256) pair in the
   * browser, persists them in two SameSite=Lax cookies so the
   * /api/v1/byok/pollinations/connect handler can replay the verifier
   * against the token endpoint, then navigates to the authorize URL with
   * code_challenge + code_challenge_method=S256.
   *
   * The /connect callback stashes the resulting token in a 60s-TTL KV
   * entry under a single-use opaque key, and redirects back to /providers
   * with ?connect=ok&provider=pollinations&redeem=<opaque>. The
   * ByokProviders parent component reads the redeem param + fetches
   * GET /api/v1/byok/pollinations/redeem?k=<opaque> to swap it for the
   * token, then writes the token to localStorage (PRIVACY-MODE).
   */
  async function handlePollinationsConnect() {
    if (typeof window === "undefined") return;
    const appKey = process.env.NEXT_PUBLIC_POLLINATIONS_APP_KEY;
    if (!appKey) {
      toast.error("Pollinations app key not configured");
      return;
    }
    setConnecting(true);
    try {
      const origin = window.location.origin.replace(/\/$/, "");
      const redirectUri = `${origin}/api/v1/byok/pollinations/connect`;

      // PKCE pair — S256 method (base64url(SHA-256(verifier))).
      const verifierBytes = new Uint8Array(32);
      window.crypto.getRandomValues(verifierBytes);
      const codeVerifier = base64UrlEncode(verifierBytes);
      const hashBuf = await window.crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(codeVerifier),
      );
      const codeChallenge = base64UrlEncode(new Uint8Array(hashBuf));

      // CSRF state — 16 random bytes hex.
      const stateBytes = new Uint8Array(16);
      window.crypto.getRandomValues(stateBytes);
      const state = Array.from(stateBytes, (b) => b.toString(16).padStart(2, "0")).join("");

      const secure = window.location.protocol === "https:" ? "; Secure" : "";
      document.cookie = `pollinations_pkce_verifier=${codeVerifier}; Path=/; SameSite=Lax${secure}; Max-Age=600`;
      document.cookie = `pollinations_oauth_state=${state}; Path=/; SameSite=Lax${secure}; Max-Age=600`;

      const params = new URLSearchParams({
        client_id: appKey,
        response_type: "code",
        redirect_uri: redirectUri,
        state,
        scope: "openid profile",
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      });
      window.location.href = `https://enter.pollinations.ai/authorize?${params.toString()}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error(`Could not start Pollinations connect: ${msg}`);
      setConnecting(false);
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
          {connected ? (
            <Badge className="border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-3 w-3" /> Connected
            </Badge>
          ) : (
            <Badge className="border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-300">
              <XCircle className="h-3 w-3" /> Not connected
            </Badge>
          )}
        </div>
        <CardDescription>{PROVIDER_DESC[source]}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {masked && (
          <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
            <span>Stored key:</span>
            <code className="font-mono text-foreground">{masked}</code>
            {addedAt && (
              <span className="text-[10px]">
                added {new Date(addedAt).toLocaleDateString()}
              </span>
            )}
            {lastValidatedAt && (
              <span className="text-[10px]">
                validated {new Date(lastValidatedAt).toLocaleString()}
              </span>
            )}
          </div>
        )}
        {source === "pollinations" &&
          process.env.NEXT_PUBLIC_POLLINATIONS_APP_KEY && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void handlePollinationsConnect()}
              disabled={connecting}
              className="self-start"
            >
              <Wallet className="h-4 w-4" />
              {connecting ? "Connecting…" : "Connect wallet"}
            </Button>
          )}
        <form onSubmit={handleSave} className="flex flex-col gap-2">
          <Label htmlFor={`byok-${source}-key`} className="text-xs">
            {label} API key
          </Label>
          <div className="relative">
            <Input
              id={`byok-${source}-key`}
              type={showKey ? "text" : "password"}
              autoComplete="off"
              placeholder={PROVIDER_PLACEHOLDER[source]}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              disabled={saving}
              className="pr-10"
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-0 top-0 h-full px-3"
              tabIndex={-1}
            >
              {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </Button>
          </div>
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

/**
 * Base64url encoder (RFC 4648 §5) — used for PKCE code_verifier and
 * code_challenge per RFC 7636. Trims `=` padding, swaps `+`→`-` and
 * `/`→`_` so the output is URL-safe without further encoding.
 */
function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ─── FreeAIXYZ API keys panel (server-persisted) ────────────────────────────

function ApiKeysPanel() {
  const [keys, setKeys] = useState<ApiKeyInfo[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState<CreatedApiKey | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/api-keys", {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) {
        setKeys([]);
        return;
      }
      const data = await res.json();
      setKeys(data.keys ?? []);
    } catch {
      setKeys([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCopied(false);
    try {
      const res = await fetch("/api/v1/api-keys", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() || "default" }),
      });
      const data = await res.json();
      if (res.ok && data.key) {
        setCreatedKey(data.key as CreatedApiKey);
        setName("");
        toast.success("API key created — copy it now, you won't see it again");
        void load();
      } else {
        toast.error(data?.error?.message ?? "Failed to create key");
      }
    } catch {
      toast.error("Network error — try again");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    if (!confirm("Revoke this API key? This cannot be undone.")) return;
    try {
      const res = await fetch(`/api/v1/api-keys/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        toast.success("API key revoked");
        void load();
      } else {
        toast.error("Failed to revoke key");
      }
    } catch {
      toast.error("Network error");
    }
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy — select and copy manually");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4" /> FreeAIXYZ API keys
        </CardTitle>
        <CardDescription>
          Programmatic gateway credentials (<code className="font-mono text-[11px]">fx_live_…</code>)
          for curl / SDK access. Stored hashed on the server (sha256). The
          full key is shown ONCE at creation — copy it before closing this panel.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={handleCreate} className="flex flex-col gap-2">
          <Label htmlFor="apikey-name" className="text-xs">
            Key name (optional)
          </Label>
          <div className="flex gap-2">
            <Input
              id="apikey-name"
              type="text"
              placeholder="e.g. My SDK"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={creating}
              className="max-w-xs"
              maxLength={64}
            />
            <Button type="submit" size="sm" disabled={creating}>
              <Plus className="h-4 w-4" />
              {creating ? "Creating…" : "Create key"}
            </Button>
          </div>
        </form>

        {createdKey && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 flex flex-col gap-2">
            <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
              New key — copy now, you won&apos;t see it again
            </div>
            <div className="flex items-center gap-2">
              <code className="font-mono text-xs break-all flex-1 bg-background/50 p-2 rounded">
                {createdKey.key}
              </code>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void copyToClipboard(createdKey.key)}
              >
                {copied ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="self-end"
              onClick={() => setCreatedKey(null)}
            >
              Dismiss
            </Button>
          </div>
        )}

        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Prefix</TableHead>
                <TableHead>Scopes</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>Created</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-4">
                    Loading…
                  </TableCell>
                </TableRow>
              )}
              {!loading && keys && keys.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-4">
                    No API keys yet. Create one above to start using the gateway programmatically.
                  </TableCell>
                </TableRow>
              )}
              {!loading && keys && keys.length > 0 && keys.map((k) => (
                <TableRow key={k.id}>
                  <TableCell className="font-medium">{k.name}</TableCell>
                  <TableCell>
                    <code className="font-mono text-xs">{k.keyPrefix}…</code>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {k.scopes.map((s) => (
                        <Badge key={s} variant="outline" className="text-[10px]">{s}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(k.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    {k.revokedAt ? (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">
                        revoked
                      </Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void handleRevoke(k.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Revoke
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Top-level component ─────────────────────────────────────────────────────

export function ByokProviders() {
  const { user, loading: authLoading } = useAuth();
  const [stored, setStored] = useState<Record<ByokSource, StoredByok | null>>({
    gratisfy: null,
    pollinations: null,
  });
  const [providers, setProviders] = useState<ProviderEntry[] | null>(null);
  const [stale, setStale] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [providerFilter, setProviderFilter] = useState("");
  const [redeeming, setRedeeming] = useState(false);

  const filteredProviders = useMemo(() => {
    if (!providers) return [];
    const q = providerFilter.trim().toLowerCase();
    if (!q) return providers;
    return providers.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.source.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q),
    );
  }, [providers, providerFilter]);

  // Load BYOK state from localStorage on mount + whenever focus returns to
  // the tab (e.g. after the OAuth round-trip).
  const reloadStored = useCallback(() => {
    setStored(loadStored());
  }, []);

  useEffect(() => {
    reloadStored();
  }, [reloadStored]);

  // OAuth redemption flow: when we land on /providers?connect=ok&redeem=<opaque>,
  // swap the opaque key for the token at /api/v1/byok/pollinations/redeem,
  // write the token to localStorage, and clean the URL.
  //
  // ROBUSTNESS FIXES (2026-08-31): the previous version (a) cleaned the URL
  // BEFORE the async fetch resolved (so a re-render mid-flight lost the
  // redeem param if a retry was needed), (b) had no retry on transient
  // failures (dev server cold-compile could make the first fetch hit a
  // 404/500 and the user saw "not connected"), and (c) swallowed the
  // actual server error message. Now we: move URL cleanup into the IIFE's
  // finally block, retry once after 1.5s on 404/network error, and
  // console.error the real response for debugging.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const status = url.searchParams.get("connect");
    const provider = url.searchParams.get("provider");
    const redeem = url.searchParams.get("redeem");
    const reason = url.searchParams.get("reason");
    const warning = url.searchParams.get("warning");

    let cancelled = false;

    const cleanUrl = () => {
      const u = new URL(window.location.href);
      u.searchParams.delete("connect");
      u.searchParams.delete("provider");
      u.searchParams.delete("redeem");
      u.searchParams.delete("reason");
      u.searchParams.delete("warning");
      window.history.replaceState({}, "", u.toString());
    };

    if (status === "ok" && provider === "pollinations" && redeem) {
      setRedeeming(true);
      (async () => {
        const attempt = async (): Promise<{ ok: boolean; token?: string; masked?: string; error?: string }> => {
          const res = await fetch(
            `/api/v1/byok/pollinations/redeem?k=${encodeURIComponent(redeem)}`,
            { credentials: "include", cache: "no-store" },
          );
          const data = await res.json().catch(() => ({}));
          if (res.ok && data.ok && data.token) {
            return { ok: true, token: data.token, masked: data.masked };
          }
          return { ok: false, error: data?.error ?? `HTTP ${res.status}` };
        };
        try {
          let result = await attempt();
          // Retry once on 404 (dev cold-compile race / transient KV lag).
          if (!result.ok && /404|not found|expired/i.test(result.error ?? "")) {
            await new Promise((r) => setTimeout(r, 1500));
            if (!cancelled) result = await attempt();
          }
          if (cancelled) return;
          if (result.ok && result.token) {
            const entry: StoredByok = {
              raw: result.token,
              masked: result.masked ?? "",
              addedAt: new Date().toISOString(),
              lastValidatedAt: new Date().toISOString(),
              lastValidationOk: true,
            };
            updateStoredEntry("pollinations", entry);
            setStored(loadStored());
            toast.success("Pollinations connected (token stored in your browser)");
            if (warning) toast.warning(warning);
          } else {
            console.error("[pollinations redeem] failed:", result.error);
            toast.error(result.error ?? "Failed to redeem Pollinations token");
          }
        } catch (err) {
          if (cancelled) return;
          console.error("[pollinations redeem] network error:", err);
          toast.error("Network error during Pollinations redemption");
        } finally {
          if (!cancelled) {
            setRedeeming(false);
            cleanUrl();
          }
        }
      })();
    } else if (status === "ok" && provider) {
      toast.success(`${provider[0].toUpperCase()}${provider.slice(1)} connected`);
      reloadStored();
      cleanUrl();
    } else if (status === "error" && provider) {
      toast.error(
        reason
          ? `${provider[0].toUpperCase()}${provider.slice(1)} connect failed: ${reason}`
          : `${provider[0].toUpperCase()}${provider.slice(1)} connect failed`,
      );
      cleanUrl();
    } else if (status || provider || redeem || reason || warning) {
      cleanUrl();
    }

    const onFocus = () => reloadStored();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [reloadStored]);

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
              keys are saved to your browser (localStorage) — never on our
              server. Sign in with just your email — no password, no
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
            BYOK keys live in your browser (localStorage) — never on our server.
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
          stored={stored.gratisfy}
          onMutated={reloadStored}
        />
        <ByokCard
          source="pollinations"
          stored={stored.pollinations}
          onMutated={reloadStored}
        />
      </div>

      {redeeming && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          <span>Redeeming Pollinations token from OAuth callback…</span>
        </div>
      )}

      <Separator />

      <ApiKeysPanel />

      <Separator />

      {/* Sources overview */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Boxes className="h-4 w-4" />
          <h2 className="text-lg font-semibold">Sources</h2>
          <span className="text-xs text-muted-foreground">
            3 sources aggregated into one OpenAI-compatible gateway
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {(
            [
              { key: "native", label: "Native", desc: "Built-in free providers" },
              { key: "gratisfy", label: "Gratisfy", desc: "BYOK gxyz-… key" },
              { key: "pollinations", label: "Pollinations", desc: "BYOK or anon" },
            ] as const
          ).map((s) => {
            const srcProviders = (providers ?? []).filter(
              (p) => p.source === s.key,
            );
            const totalModels = srcProviders.reduce(
              (sum, p) => sum + (p.modelCount ?? 0),
              0,
            );
            return (
              <Card key={s.key} className="py-3">
                <CardContent className="flex flex-col gap-1 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{s.label}</span>
                    <SourceBadge source={s.key} />
                  </div>
                  <p className="text-xs text-muted-foreground">{s.desc}</p>
                  <div className="flex items-baseline gap-3 mt-1">
                    <span className="text-xl font-bold tabular-nums">
                      {srcProviders.length}
                    </span>
                    <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      providers
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2 text-xs text-muted-foreground">
                    <Cpu className="h-3 w-3" />
                    <span className="tabular-nums">{totalModels.toLocaleString()}</span>
                    <span>models</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <Separator />

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Unified catalog</h2>
            <p className="text-xs text-muted-foreground">
              {providers
                ? `Showing all ${providers.length} providers across 3 sources${stale ? " (catalog stale)" : ""}.`
                : "No providers loaded."}
            </p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              type="search"
              placeholder="Filter providers or sources…"
              value={providerFilter}
              onChange={(e) => setProviderFilter(e.target.value)}
              className="pl-8 h-9"
            />
          </div>
        </div>
        <div className="overflow-x-auto rounded-md border">
          <div className="max-h-[640px] overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>BYOK</TableHead>
                  <TableHead className="text-right">Models</TableHead>
                  <TableHead>Discovered</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProviders.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="text-center text-sm text-muted-foreground py-6"
                    >
                      {providers
                        ? "No providers match your filter."
                        : "Loading providers…"}
                    </TableCell>
                  </TableRow>
                )}
                {filteredProviders.map((p) => (
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
        </div>
      </div>
    </div>
  );
}

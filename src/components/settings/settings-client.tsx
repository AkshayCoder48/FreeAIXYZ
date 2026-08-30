"use client";

/**
 * SettingsClient — the interactive settings surface (PRD §61).
 *
 * Receives its initial state (BYOK meta, API keys, XYZ balance/transactions/
 * usage, unified providers) as a prop from the RSC (src/app/settings/page.tsx)
 * — the page does the server-side fetch and passes a JSON-serializable shape
 * to us. We own all the interactive parts:
 *
 *   - BYOK save / test / remove (POST/DELETE /api/v1/byok/{provider}[/test])
 *   - API key create / list / revoke + the reveal-once modal
 *   - Usage tables (server-provided rows; refresh button calls the live API)
 *   - Theme toggle (next-themes)
 *   - Default model select (localStorage; surface what /api/v1/models/unified
 *     returns)
 *   - Diagnostics: provider status grid + "Refresh models" button (POST
 *     /api/discovery/refresh)
 *
 * If `data` is null we render the sign-in card (server already detected that
 * we're not authed; the card is just an entry-point back into the auth flow).
 *
 * Styling: shadcn Card / Badge / Button / Input / Tabs / Table / Dialog /
 * Sonner. NO indigo / blue — only slate, emerald, amber, violet, orange.
 * Mobile-first responsive 320→1440+. Sticky footer comes from the RSC.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Copy,
  Cpu,
  DollarSign,
  KeyRound,
  Layers,
  Loader2,
  LogOut,
  Mail,
  Monitor,
  Moon,
  Plug,
  RefreshCw,
  Server,
  Settings as SettingsIcon,
  Sparkles,
  Sun,
  Trash2,
  TriangleAlert,
  User,
} from "lucide-react";
import { useTheme } from "next-themes";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/use-auth";
import { SignInDialog } from "@/components/auth/sign-in-dialog";

// ─── Types (mirror of the server-side types, but JSON-serializable) ─────────

export type SettingsByokProvider = "gratisfy" | "g4f";

export interface SettingsByokMeta {
  provider: SettingsByokProvider;
  connected: boolean;
  masked: string;
  addedAt: string;
  lastValidatedAt?: string;
  lastValidationOk?: boolean;
}

export interface SettingsApiKeyInfo {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface SettingsBalance {
  xyzBalance: number;
  lifetimeEarned: number;
  lifetimeSpent: number;
  lastDailyGrantAt?: string;
  updatedAt: string;
}

export type SettingsSource = "native" | "gratisfy" | "g4f";

export interface SettingsTransaction {
  id: string;
  type: string;
  amount: number;
  balanceAfter: number;
  requestId?: string;
  source?: SettingsSource;
  provider?: string;
  model?: string;
  note?: string;
  createdAt: string;
}

export interface SettingsUsageRecord {
  requestId: string;
  source?: SettingsSource;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  usdCost: number;
  xyzCost: number;
  pricingVersion: number;
  timestamp: string;
}

export interface SettingsProviderInfo {
  id: string;
  name: string;
  source: SettingsSource;
  requiresApiKey: boolean;
  supportsModelDiscovery: boolean;
  modelCount: number;
  lastDiscoveredAt: string;
}

export interface SettingsData {
  byok: Record<SettingsByokProvider, SettingsByokMeta>;
  apiKeys: SettingsApiKeyInfo[];
  balance: SettingsBalance | null;
  transactions: SettingsTransaction[];
  usage: SettingsUsageRecord[];
  providers: SettingsProviderInfo[];
  unifiedModelsCount: number;
  catalogStale: boolean;
}

export interface SettingsUser {
  id: string;
  email: string;
  emailVerified: boolean;
  createdAt: string;
  lastLoginAt?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function maskKey(prefix: string, suffix: string): string {
  // Show first 12 chars + dots + last 4 chars. Matches the byok module's
  // masked key representation (PRD §16 — never expose the full key).
  if (!prefix) return "—";
  if (prefix.length < 12) return prefix;
  return `${prefix}${"•".repeat(8)}${suffix || ""}`;
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const then = new Date(iso).getTime();
    const now = Date.now();
    const deltaMs = now - then;
    if (deltaMs < 60_000) return "just now";
    const mins = Math.floor(deltaMs / 60_000);
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.floor(hours / 24);
    return `${days} d ago`;
  } catch {
    return "—";
  }
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return "—";
  }
}

// ─── Sign-in card (rendered when not authed) ────────────────────────────────

function SettingsSignInCard() {
  const [open, setOpen] = useState(false);
  return (
    <Card className="max-w-md w-full mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" /> Sign in required
        </CardTitle>
        <CardDescription>
          Settings are only available to signed-in users. Sign in with a
          one-time email code to manage your BYOK keys, API keys, and
          preferences.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={() => setOpen(true)} className="w-full">
          Continue with email
        </Button>
        <SignInDialog
          open={open}
          onOpenChange={setOpen}
          onSignedIn={() => {
            // Hard reload so the RSC re-runs with the new session cookie
            // and re-fetches all server-side data. Otherwise we'd render the
            // tab UI with stale `data === null` (empty defaults).
            if (typeof window !== "undefined") window.location.reload();
          }}
        />
      </CardContent>
    </Card>
  );
}

// ─── Small presentational bits ─────────────────────────────────────────────

function SourceBadge({ source }: { source: SettingsSource }) {
  const label = source.toUpperCase();
  const cls =
    source === "gratisfy"
      ? "border-transparent bg-violet-500/15 text-violet-700 dark:text-violet-300"
      : source === "g4f"
        ? "border-transparent bg-orange-500/15 text-orange-700 dark:text-orange-300"
        : "border-transparent bg-slate-500/15 text-slate-700 dark:text-slate-300";
  return <Badge className={cls}>{label}</Badge>;
}

function ByokStatusBadge({ meta }: { meta: SettingsByokMeta | null }) {
  if (!meta || !meta.connected) {
    return (
      <Badge
        variant="outline"
        className="border-slate-400/40 bg-slate-500/10 text-slate-600 dark:text-slate-300"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />
        Not connected
      </Badge>
    );
  }
  if (meta.lastValidationOk === false) {
    return (
      <Badge
        variant="outline"
        className="border-amber-400/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
      >
        <TriangleAlert className="h-3 w-3" />
        Invalid
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="border-emerald-400/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
    >
      <CheckCircle2 className="h-3 w-3" />
      Connected
    </Badge>
  );
}

function ProviderStatusBadge({ status }: { status: string }) {
  // Maps Prisma Provider.status → colored badge. Possible values: available,
  // degraded, unavailable, unknown, needs_key (PRD §21).
  const cls =
    status === "available"
      ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : status === "degraded"
        ? "border-amber-400/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : status === "unavailable" || status === "needs_key"
          ? "border-rose-400/40 bg-rose-500/10 text-rose-700 dark:text-rose-300"
          : "border-slate-400/40 bg-slate-500/10 text-slate-600 dark:text-slate-300";
  return (
    <Badge variant="outline" className={cls}>
      {status}
    </Badge>
  );
}

function TransactionTypeBadge({ type }: { type: string }) {
  const cls =
    type === "DAILY_GRANT"
      ? "border-transparent bg-violet-500/15 text-violet-700 dark:text-violet-300"
      : type === "REFUND"
        ? "border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
        : type === "ADMIN_ADJUSTMENT"
          ? "border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-300"
          : "border-transparent bg-slate-500/15 text-slate-700 dark:text-slate-300";
  return <Badge className={cls}>{type}</Badge>;
}

// ─── BYOK card (Gratisfy / G4F) ─────────────────────────────────────────────

interface ByokSaveResponse {
  ok: boolean;
  meta?: { provider: string; connected: boolean; masked: string; addedAt: string };
  error?: string;
  validation?: { ok: boolean; modelCount?: number };
  modelsDiscovered?: number;
  stale?: boolean;
}

interface ByokTestResponse {
  ok: boolean;
  error?: string;
  providerCount?: number;
  modelCount?: number;
}

function ByokCard({
  provider,
  initial,
  onChanged,
}: {
  provider: SettingsByokProvider;
  initial: SettingsByokMeta;
  onChanged: (next: SettingsByokMeta) => void;
}) {
  const isGratisfy = provider === "gratisfy";
  const label = isGratisfy ? "Gratisfy" : "G4F";
  const base = `/api/v1/byok/${provider}`;
  const testEndpoint = `${base}/test`;
  const placeholder = isGratisfy ? "gxyz-…" : "g4f_…";
  const help = isGratisfy
    ? "Bring your own gxyz-… key from Gratisfy. Stored encrypted-at-rest; we never expose the raw key."
    : "Bring your own g4f_… key from g4f.dev. Discovery is public; the key is only used at chat time.";

  const [keyInput, setKeyInput] = useState("");
  // The card's local `meta` state is the canonical source of truth once the
  // card mounts — every mutation handler calls `setMeta(next)` AND
  // `onChanged(next)`. No need to sync from `initial` prop after mount
  // (would cause cascading renders — react-hooks/set-state-in-effect).
  const [meta, setMeta] = useState<SettingsByokMeta>(initial);
  const [revealInput, setRevealInput] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [validationNote, setValidationNote] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = keyInput.trim();
    if (!trimmed) {
      toast.error("Paste a key first");
      return;
    }
    setSaving(true);
    setValidationNote(null);
    try {
      const res = await fetch(base, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: trimmed }),
      });
      const data: ByokSaveResponse = await res.json();
      if (res.ok && data.ok) {
        const next: SettingsByokMeta = {
          provider,
          connected: true,
          masked: data.meta?.masked ?? maskKey(trimmed.slice(0, 12), trimmed.slice(-4)),
          addedAt: data.meta?.addedAt ?? new Date().toISOString(),
          lastValidatedAt: new Date().toISOString(),
          lastValidationOk: true,
        };
        setMeta(next);
        onChanged(next);
        setKeyInput("");
        const discovered =
          typeof data.modelsDiscovered === "number" ? data.modelsDiscovered : null;
        toast.success(
          `${label} key saved and validated${
            discovered !== null ? ` · ${discovered} models discovered` : ""
          }`,
        );
      } else {
        // Key saved but invalid — update local meta to reflect validation state.
        const next: SettingsByokMeta = {
          provider,
          connected: true,
          masked: data.meta?.masked ?? maskKey(trimmed.slice(0, 12), trimmed.slice(-4)),
          addedAt: data.meta?.addedAt ?? new Date().toISOString(),
          lastValidatedAt: new Date().toISOString(),
          lastValidationOk: false,
        };
        setMeta(next);
        onChanged(next);
        setKeyInput("");
        setValidationNote(data.error ?? "Validation failed");
        toast.error(data.error ?? `${label} key invalid`);
      }
    } catch {
      toast.error("Network error — try again");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setValidationNote(null);
    try {
      const res = await fetch(testEndpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(keyInput.trim() ? { key: keyInput.trim() } : {}),
      });
      const data: ByokTestResponse = await res.json();
      if (res.ok && data.ok) {
        const next: SettingsByokMeta = {
          ...meta,
          lastValidatedAt: new Date().toISOString(),
          lastValidationOk: true,
        };
        setMeta(next);
        onChanged(next);
        const count = data.modelCount ?? 0;
        toast.success(
          `${label} key valid${count > 0 ? ` · ${count} models visible` : ""}`,
        );
      } else {
        const next: SettingsByokMeta = {
          ...meta,
          lastValidatedAt: new Date().toISOString(),
          lastValidationOk: false,
        };
        setMeta(next);
        onChanged(next);
        setValidationNote(data.error ?? `${label} key invalid`);
        toast.error(data.error ?? `${label} key invalid`);
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
        const next: SettingsByokMeta = {
          provider,
          connected: false,
          masked: "",
          addedAt: "",
        };
        setMeta(next);
        onChanged(next);
        setKeyInput("");
        setValidationNote(null);
        toast.success(`${label} key removed`);
      } else {
        toast.error(`Failed to remove ${label} key`);
      }
    } catch {
      toast.error("Network error — try again");
    } finally {
      setRemoving(false);
    }
  }

  const canTest = Boolean(meta.connected || keyInput.trim());

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2 flex-wrap">
          <CardTitle className="text-base">{label}</CardTitle>
          <Badge
            variant="outline"
            className={
              isGratisfy
                ? "border-transparent bg-violet-500/15 text-violet-700 dark:text-violet-300"
                : "border-transparent bg-orange-500/15 text-orange-700 dark:text-orange-300"
            }
          >
            BYOK
          </Badge>
          <ByokStatusBadge meta={meta} />
        </div>
        <CardDescription>{help}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {meta.masked && (
          <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
            <span>Stored key:</span>
            <code className="font-mono text-foreground bg-muted/60 px-2 py-0.5 rounded">
              {meta.masked}
            </code>
            {meta.lastValidatedAt && (
              <span className="text-muted-foreground/80">
                · last validated {formatRelative(meta.lastValidatedAt)}
              </span>
            )}
          </div>
        )}
        {validationNote && (
          <div className="rounded-md border border-amber-400/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span className="min-w-0" style={{ overflowWrap: "anywhere" }}>
              {validationNote}
            </span>
          </div>
        )}
        <form onSubmit={handleSave} className="flex flex-col gap-2">
          <Label htmlFor={`byok-${provider}-key`} className="text-xs">
            {label} API key
          </Label>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              id={`byok-${provider}-key`}
              type={revealInput ? "text" : "password"}
              autoComplete="off"
              placeholder={placeholder}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              disabled={saving}
              className="font-mono"
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setRevealInput((v) => !v)}
              className="shrink-0"
              aria-label={revealInput ? "Hide key" : "Reveal key"}
            >
              {revealInput ? "Hide" : "Reveal"}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <KeyRound className="h-4 w-4" />
              )}
              {saving ? "Saving…" : "Save & Validate"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleTest}
              disabled={testing || !canTest}
            >
              {testing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              {testing ? "Testing…" : "Test"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleRemove}
              disabled={removing || !meta.connected}
              className="text-rose-600 hover:text-rose-700 dark:text-rose-400"
            >
              {removing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              {removing ? "Removing…" : "Remove"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ─── API Keys tab ────────────────────────────────────────────────────────────

interface CreateApiKeyResponse {
  key?: {
    id: string;
    name: string;
    keyPrefix: string;
    scopes: string[];
    lastUsedAt: string | null;
    revokedAt: string | null;
    createdAt: string;
    key: string; // full key — only at creation
  };
  error?: { type: string; message: string };
}

function ApiKeysSection({
  initial,
  onChanged,
}: {
  initial: SettingsApiKeyInfo[];
  onChanged: (next: SettingsApiKeyInfo[]) => void;
}) {
  const [keys, setKeys] = useState<SettingsApiKeyInfo[]>(initial);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState("chat, models");
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [reveal, setReveal] = useState<{
    open: boolean;
    fullKey: string;
    meta: SettingsApiKeyInfo | null;
  }>({ open: false, fullKey: "", meta: null });

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim() || "default";
    const scopeList = scopes
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    setCreating(true);
    try {
      const res = await fetch("/api/v1/api-keys", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          scopes: scopeList.length ? scopeList : ["chat", "models"],
        }),
      });
      const data: CreateApiKeyResponse = await res.json();
      if (res.ok && data.key) {
        const newInfo: SettingsApiKeyInfo = {
          id: data.key.id,
          name: data.key.name,
          keyPrefix: data.key.keyPrefix,
          scopes: data.key.scopes,
          lastUsedAt: data.key.lastUsedAt,
          revokedAt: data.key.revokedAt,
          createdAt: data.key.createdAt,
        };
        const next = [newInfo, ...keys];
        setKeys(next);
        onChanged(next);
        setName("");
        setScopes("chat, models");
        setReveal({ open: true, fullKey: data.key.key, meta: newInfo });
        toast.success("API key created");
      } else {
        toast.error(data.error?.message ?? "Failed to create key");
      }
    } catch {
      toast.error("Network error — try again");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    setRevokingId(id);
    try {
      const res = await fetch(`/api/v1/api-keys/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        const next = keys.map((k) =>
          k.id === id ? { ...k, revokedAt: new Date().toISOString() } : k,
        );
        setKeys(next);
        onChanged(next);
        toast.success("Key revoked");
      } else {
        const data = await res.json().catch(() => null);
        toast.error(data?.error?.message ?? "Failed to revoke");
      }
    } catch {
      toast.error("Network error — try again");
    } finally {
      setRevokingId(null);
    }
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Couldn't copy — select and copy manually");
    }
  }

  return (
    <div className="flex flex-col gap-4 min-w-0">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4" /> Create new API key
          </CardTitle>
          <CardDescription>
            Use <code className="font-mono text-foreground">fx_live_*</code> keys
            to authenticate programmatic requests. The full key is shown ONCE
            here — copy it now; we won&apos;t show it again.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="apikey-name" className="text-xs">
                Name
              </Label>
              <Input
                id="apikey-name"
                type="text"
                placeholder="e.g. CI runner"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={creating}
                maxLength={64}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="apikey-scopes" className="text-xs">
                Scopes (comma-separated)
              </Label>
              <Input
                id="apikey-scopes"
                type="text"
                className="font-mono"
                placeholder="chat, models"
                value={scopes}
                onChange={(e) => setScopes(e.target.value)}
                disabled={creating}
              />
              <p className="text-[11px] text-muted-foreground">
                Common scopes: <code className="font-mono">chat</code>,{" "}
                <code className="font-mono">models</code>,{" "}
                <code className="font-mono">pricing</code>,{" "}
                <code className="font-mono">*</code>.
              </p>
            </div>
            <div>
              <Button type="submit" size="sm" disabled={creating}>
                {creating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <KeyRound className="h-4 w-4" />
                )}
                {creating ? "Creating…" : "Create key"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="h-4 w-4" /> Your keys
          </CardTitle>
          <CardDescription>
            {keys.length === 0
              ? "No keys yet — create one above."
              : `${keys.length} key${keys.length === 1 ? "" : "s"} total.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border min-w-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Scopes</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center text-sm text-muted-foreground py-6"
                    >
                      No API keys yet.
                    </TableCell>
                  </TableRow>
                )}
                {keys.map((k) => {
                  const revoked = Boolean(k.revokedAt);
                  return (
                    <TableRow
                      key={k.id}
                      className={revoked ? "opacity-60" : undefined}
                    >
                      <TableCell className="font-medium">{k.name}</TableCell>
                      <TableCell>
                        <code className="font-mono text-xs">
                          {k.keyPrefix}
                          <span className="text-muted-foreground">
                            {"•".repeat(8)}
                            {k.keyPrefix.slice(-4) || ""}
                          </span>
                        </code>
                      </TableCell>
                      <TableCell className="text-xs">
                        <div className="flex flex-wrap gap-1">
                          {k.scopes.map((s) => (
                            <Badge
                              key={s}
                              variant="outline"
                              className="text-[10px] font-mono"
                            >
                              {s}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatRelative(k.lastUsedAt)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatRelative(k.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        {revoked ? (
                          <Badge
                            variant="outline"
                            className="text-[10px] border-slate-400/40 bg-slate-500/10 text-slate-600 dark:text-slate-300"
                          >
                            revoked
                          </Badge>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleRevoke(k.id)}
                            disabled={revokingId === k.id}
                            className="text-rose-600 hover:text-rose-700 dark:text-rose-400"
                          >
                            {revokingId === k.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                            Revoke
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Reveal-once modal */}
      <Dialog
        open={reveal.open}
        onOpenChange={(o) => {
          setReveal((r) => ({ ...r, open: o }));
          if (!o) {
            // Clear the full key from memory as soon as the modal closes.
            setTimeout(() => setReveal({ open: false, fullKey: "", meta: null }), 200);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4" /> Your new API key
            </DialogTitle>
            <DialogDescription>
              Copy this key now — it won&apos;t be shown again.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-amber-400/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              Treat this key like a password. Anyone with it can call the API
              as you. Revoke immediately if it leaks.
            </span>
          </div>
          <div className="flex items-stretch gap-2">
            <code
              className="flex-1 min-w-0 font-mono text-xs break-all rounded-md border bg-muted/60 px-3 py-2"
              style={{ overflowWrap: "anywhere", wordBreak: "break-all" }}
            >
              {reveal.fullKey}
            </code>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => copyToClipboard(reveal.fullKey)}
              className="shrink-0"
            >
              <Copy className="h-4 w-4" /> Copy
            </Button>
          </div>
          <DialogFooter>
            <Button
              type="button"
              size="sm"
              onClick={() =>
                setReveal((r) => ({ ...r, open: false }))
              }
            >
              I&apos;ve copied it — close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Usage tab ───────────────────────────────────────────────────────────────

function UsageSection({
  initialBalance,
  initialTransactions,
  initialUsage,
}: {
  initialBalance: SettingsBalance | null;
  initialTransactions: SettingsTransaction[];
  initialUsage: SettingsUsageRecord[];
}) {
  const [balance, setBalance] = useState<SettingsBalance | null>(initialBalance);
  const [transactions, setTransactions] =
    useState<SettingsTransaction[]>(initialTransactions);
  const [usage, setUsage] = useState<SettingsUsageRecord[]>(initialUsage);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [b, t, u] = await Promise.all([
        fetch("/api/v1/xyz/balance", { credentials: "include", cache: "no-store" }).then((r) =>
          r.ok ? r.json() : null,
        ),
        fetch("/api/v1/xyz/transactions?limit=50", {
          credentials: "include",
          cache: "no-store",
        }).then((r) => (r.ok ? r.json() : null)),
        fetch("/api/v1/xyz/usage?limit=50", {
          credentials: "include",
          cache: "no-store",
        }).then((r) => (r.ok ? r.json() : null)),
      ]);
      if (b?.balance) setBalance(b.balance);
      if (t?.transactions) setTransactions(t.transactions);
      if (u?.usage) setUsage(u.usage);
      toast.success("Refreshed usage");
    } catch {
      toast.error("Failed to refresh usage");
    } finally {
      setRefreshing(false);
    }
  }, []);

  return (
    <div className="flex flex-col gap-4 min-w-0">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <DollarSign className="h-4 w-4" /> XYZ balance
        </h2>
        <Button size="sm" variant="outline" onClick={refresh} disabled={refreshing}>
          {refreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardDescription>Current balance</CardDescription>
          <CardTitle className="text-4xl font-bold tracking-tight">
            {balance ? `${balance.xyzBalance.toFixed(2)} XYZ` : "—"}
          </CardTitle>
          {balance && (
            <CardDescription className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
              <span>lifetime earned: {balance.lifetimeEarned.toFixed(2)}</span>
              <span>lifetime spent: {balance.lifetimeSpent.toFixed(2)}</span>
              {balance.lastDailyGrantAt && (
                <span>
                  last daily grant: {formatRelative(balance.lastDailyGrantAt)}
                </span>
              )}
            </CardDescription>
          )}
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Layers className="h-4 w-4" /> Transactions
            <Badge variant="outline" className="text-[10px]">
              last 50
            </Badge>
          </CardTitle>
          <CardDescription>Immutable XYZ ledger.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border min-w-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">After</TableHead>
                  <TableHead>Model / Provider</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center text-sm text-muted-foreground py-6"
                    >
                      No transactions yet.
                    </TableCell>
                  </TableRow>
                )}
                {transactions.map((t) => {
                  const positive = t.amount >= 0;
                  return (
                    <TableRow key={t.id}>
                      <TableCell>
                        <TransactionTypeBadge type={t.type} />
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono ${
                          positive
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-rose-600 dark:text-rose-400"
                        }`}
                      >
                        {positive ? "+" : ""}
                        {t.amount.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {t.balanceAfter.toFixed(2)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {t.model ? (
                          <div className="flex flex-col gap-0.5">
                            <span>{t.model}</span>
                            {t.provider && (
                              <span className="text-muted-foreground">
                                {t.provider}
                                {t.source && ` · ${t.source}`}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                        {t.note ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDateTime(t.createdAt)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Cpu className="h-4 w-4" /> Usage records
            <Badge variant="outline" className="text-[10px]">
              last 50
            </Badge>
          </CardTitle>
          <CardDescription>
            Per-request token usage. USD cost × XYZ multiplier = XYZ cost.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border min-w-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead className="text-right">In</TableHead>
                  <TableHead className="text-right">Out</TableHead>
                  <TableHead className="text-right">USD</TableHead>
                  <TableHead className="text-right">XYZ</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usage.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="text-center text-sm text-muted-foreground py-6"
                    >
                      No usage yet.
                    </TableCell>
                  </TableRow>
                )}
                {usage.map((u) => (
                  <TableRow key={u.requestId}>
                    <TableCell className="font-mono text-xs">{u.model}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {u.provider}
                      {u.source && (
                        <span className="text-muted-foreground"> · {u.source}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {u.inputTokens.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {u.outputTokens.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      ${u.usdCost.toFixed(4)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {u.xyzCost.toFixed(4)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDateTime(u.timestamp)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Diagnostics tab ─────────────────────────────────────────────────────────

function DiagnosticsSection({
  initialProviders,
  unifiedModelsCount,
  catalogStale,
}: {
  initialProviders: SettingsProviderInfo[];
  unifiedModelsCount: number;
  catalogStale: boolean;
}) {
  const [providers, setProviders] =
    useState<SettingsProviderInfo[]>(initialProviders);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // 1) Trigger a discovery refresh (POST /api/discovery/refresh). This is
      //    a long-running call; we don't await it indefinitely.
      const refreshPromise = fetch("/api/discovery/refresh", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }).catch(() => null);

      // 2) After triggering, fetch the live providers list. The catalog may
      //    still be the same as before if discovery was instant; either way we
      //    show fresh data.
      const provRes = await fetch("/api/v1/providers", {
        credentials: "include",
        cache: "no-store",
      });
      if (provRes.ok) {
        const provData = await provRes.json();
        if (Array.isArray(provData.providers)) {
          setProviders(provData.providers);
        }
      }
      // Wait for the refresh to complete (best-effort; toast the result).
      const refreshRes = await refreshPromise;
      if (refreshRes && refreshRes.ok) {
        const refreshData = await refreshRes.json().catch(() => null);
        const count = Array.isArray(refreshData?.results)
          ? refreshData.results.length
          : 0;
        toast.success(`Discovery refreshed${count ? ` · ${count} providers` : ""}`);
        // Re-fetch providers after the refresh completes.
        const provRes2 = await fetch("/api/v1/providers", {
          credentials: "include",
          cache: "no-store",
        });
        if (provRes2.ok) {
          const provData2 = await provRes2.json();
          if (Array.isArray(provData2.providers)) {
            setProviders(provData2.providers);
          }
        }
      } else if (refreshRes) {
        toast.error("Discovery refresh failed");
      }
    } catch {
      toast.error("Network error — try again");
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Aggregate by source for a summary card.
  const bySource = useMemo(() => {
    const m = new Map<SettingsSource, number>();
    for (const p of providers) {
      m.set(p.source, (m.get(p.source) ?? 0) + p.modelCount);
    }
    return {
      native: m.get("native") ?? 0,
      gratisfy: m.get("gratisfy") ?? 0,
      g4f: m.get("g4f") ?? 0,
    };
  }, [providers]);

  return (
    <div className="flex flex-col gap-4 min-w-0">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Server className="h-4 w-4" /> Provider status
        </h2>
        <Button size="sm" variant="outline" onClick={refresh} disabled={refreshing}>
          {refreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {refreshing ? "Refreshing…" : "Refresh models"}
        </Button>
      </div>

      {catalogStale && (
        <div className="rounded-md border border-amber-400/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>
            Catalog is being served from cache — the last G4F discovery run may
            have been stale. Native pricing is unaffected.
          </span>
        </div>
      )}

      {/* Summary cards by source */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 min-w-0">
        <Card className="min-w-0">
          <CardHeader className="pb-3">
            <CardDescription className="flex items-center gap-2">
              <Badge
                variant="outline"
                className="border-transparent bg-slate-500/15 text-slate-700 dark:text-slate-300"
              >
                NATIVE
              </Badge>
              models
            </CardDescription>
            <CardTitle className="text-2xl font-bold">
              {bySource.native.toLocaleString()}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card className="min-w-0">
          <CardHeader className="pb-3">
            <CardDescription className="flex items-center gap-2">
              <Badge
                variant="outline"
                className="border-transparent bg-violet-500/15 text-violet-700 dark:text-violet-300"
              >
                GRATISFY
              </Badge>
              models
            </CardDescription>
            <CardTitle className="text-2xl font-bold">
              {bySource.gratisfy.toLocaleString()}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card className="min-w-0">
          <CardHeader className="pb-3">
            <CardDescription className="flex items-center gap-2">
              <Badge
                variant="outline"
                className="border-transparent bg-orange-500/15 text-orange-700 dark:text-orange-300"
              >
                G4F
              </Badge>
              models
            </CardDescription>
            <CardTitle className="text-2xl font-bold">
              {bySource.g4f.toLocaleString()}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Layers className="h-4 w-4" /> Unified catalog
          </CardTitle>
          <CardDescription>
            {providers.length} provider{providers.length === 1 ? "" : "s"} ·{" "}
            {unifiedModelsCount.toLocaleString()} total models
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border min-w-0 max-h-96 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow className="sticky top-0 bg-card z-10">
                  <TableHead>Provider</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>BYOK</TableHead>
                  <TableHead className="text-right">Models</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Discovered</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {providers.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center text-sm text-muted-foreground py-6"
                    >
                      No providers loaded.
                    </TableCell>
                  </TableRow>
                )}
                {providers.map((p) => {
                  const status = p.requiresApiKey
                    ? p.modelCount > 0
                      ? "available"
                      : "needs_key"
                    : p.modelCount > 0
                      ? "available"
                      : "unavailable";
                  return (
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
                        {p.modelCount.toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <ProviderStatusBadge status={status} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatRelative(p.lastDiscoveredAt)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Account tab ────────────────────────────────────────────────────────────

function AccountSection({
  user,
  onSignOut,
}: {
  user: SettingsUser;
  onSignOut: () => Promise<void>;
}) {
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await onSignOut();
      toast.success("Signed out");
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 min-w-0">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <User className="h-4 w-4" /> Account
          </CardTitle>
          <CardDescription>
            Your account identity. Email is the only credential — no
            password to forget.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 min-w-0">
            <div className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                Email
              </span>
              <span className="font-mono text-sm break-all">{user.email}</span>
              {user.emailVerified && (
                <Badge
                  variant="outline"
                  className="border-emerald-400/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 w-fit mt-1"
                >
                  <CheckCircle2 className="h-3 w-3" /> Verified
                </Badge>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                Account ID
              </span>
              <span className="font-mono text-xs break-all text-muted-foreground">
                {user.id}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                Created
              </span>
              <span className="text-sm">{formatDateTime(user.createdAt)}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                Last login
              </span>
              <span className="text-sm">{formatDateTime(user.lastLoginAt)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="h-4 w-4" /> Session
          </CardTitle>
          <CardDescription>
            Your session cookie (<code className="font-mono text-foreground">fxz_session</code>)
            lasts 7 days from issue. Sign out to clear it from this device.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSignOut}
            disabled={signingOut}
            className="text-rose-600 hover:text-rose-700 dark:text-rose-400"
          >
            {signingOut ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <LogOut className="h-4 w-4" />
            )}
            {signingOut ? "Signing out…" : "Log out"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── BYOK tab wrapper ───────────────────────────────────────────────────────

function ByokSection({
  initialByok,
}: {
  initialByok: Record<SettingsByokProvider, SettingsByokMeta>;
}) {
  const [byok, setByok] =
    useState<Record<SettingsByokProvider, SettingsByokMeta>>(initialByok);

  const onGratisfyChanged = useCallback((next: SettingsByokMeta) => {
    setByok((b) => ({ ...b, gratisfy: next }));
  }, []);
  const onG4fChanged = useCallback((next: SettingsByokMeta) => {
    setByok((b) => ({ ...b, g4f: next }));
  }, []);

  return (
    <div className="flex flex-col gap-4 min-w-0">
      <div className="flex items-center gap-2">
        <Plug className="h-4 w-4" />
        <h2 className="text-sm font-semibold">Bring-your-own-key providers</h2>
      </div>
      <p className="text-xs text-muted-foreground -mt-2">
        Keys are encrypted-at-rest and never returned to the browser. Validation
        hits the real upstream — no spurious &ldquo;Connected&rdquo; badge (PRD
        §82).
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 min-w-0">
        <ByokCard
          provider="gratisfy"
          initial={byok.gratisfy}
          onChanged={onGratisfyChanged}
        />
        <ByokCard
          provider="g4f"
          initial={byok.g4f}
          onChanged={onG4fChanged}
        />
      </div>
    </div>
  );
}

// ─── Preferences tab ────────────────────────────────────────────────────────

const PREFS_DEFAULT_MODEL_KEY = "freeaixyz:default-model";

function PreferencesSection({
  initialProviders,
}: {
  initialProviders: SettingsProviderInfo[];
}) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [defaultModel, setDefaultModel] = useState<string>("");
  const [models, setModels] = useState<
    { id: string; displayName: string; source: SettingsSource }[]
  >(initialProviders.map((p) => ({ id: p.id, displayName: p.name, source: p.source })));
  const [loadingModels, setLoadingModels] = useState(false);

  // next-themes needs mounted gate.
  useEffect(() => {
    setMounted(true);
  }, []);

  // Load default-model pref from localStorage.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(PREFS_DEFAULT_MODEL_KEY);
      if (saved) setDefaultModel(saved);
    } catch {
      // localStorage may be blocked — ignore.
    }
  }, []);

  // Fetch full unified models list (only if there are models — this is a
  // best-effort enrichment of the server-provided providers list).
  const loadModels = useCallback(async () => {
    setLoadingModels(true);
    try {
      const res = await fetch("/api/v1/models/unified", {
        credentials: "include",
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.data)) {
          setModels(
            data.data.map((m: { id: string; displayName: string; source: SettingsSource }) => ({
              id: m.id,
              displayName: m.displayName,
              source: m.source,
            })),
          );
          toast.success(`Loaded ${data.data.length} models`);
        }
      }
    } catch {
      // ignore
    } finally {
      setLoadingModels(false);
    }
  }, []);

  function onDefaultModelChange(value: string) {
    setDefaultModel(value);
    try {
      localStorage.setItem(PREFS_DEFAULT_MODEL_KEY, value);
      toast.success("Default model saved");
    } catch {
      toast.error("Couldn't save preference (localStorage blocked)");
    }
  }

  const themeOptions = [
    { value: "light", icon: Sun, label: "Light" },
    { value: "dark", icon: Moon, label: "Dark" },
    { value: "system", icon: Monitor, label: "System" },
  ] as const;

  return (
    <div className="flex flex-col gap-4 min-w-0">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <SettingsIcon className="h-4 w-4" /> Theme
          </CardTitle>
          <CardDescription>
            Switch between light, dark, or system theme. Saved to a cookie via{" "}
            <code className="font-mono text-foreground">next-themes</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3 max-w-md">
            {themeOptions.map((opt) => {
              const active = mounted && theme === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setTheme(opt.value)}
                  className={`flex flex-col items-center gap-2 p-4 rounded-md border transition-colors ${
                    active
                      ? "border-emerald-400/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      : "border-border bg-background hover:bg-accent"
                  }`}
                  aria-pressed={active}
                >
                  <opt.icon className="h-5 w-5" />
                  <span className="text-xs font-medium">{opt.label}</span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Cpu className="h-4 w-4" /> Default model
            <Badge variant="outline" className="text-[10px]">
              optional
            </Badge>
          </CardTitle>
          <CardDescription>
            Pre-selects a model in the playground. Stored locally in your
            browser — not synced server-side.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2">
            <Select value={defaultModel} onValueChange={onDefaultModelChange}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="No default — let the playground pick" />
              </SelectTrigger>
              <SelectContent>
                {models.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    <span className="flex items-center gap-2">
                      <SourceBadge source={m.source} />
                      <span className="font-mono text-xs">{m.displayName}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                size="sm"
                variant="outline"
                onClick={loadModels}
                disabled={loadingModels}
              >
                {loadingModels ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                {loadingModels ? "Loading…" : "Refresh models list"}
              </Button>
              {defaultModel && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setDefaultModel("");
                    try {
                      localStorage.removeItem(PREFS_DEFAULT_MODEL_KEY);
                    } catch {
                      // ignore
                    }
                    toast.success("Default cleared");
                  }}
                  className="text-rose-600 hover:text-rose-700 dark:text-rose-400"
                >
                  Clear
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main SettingsClient ────────────────────────────────────────────────────

export function SettingsClient({
  data,
  user: serverUser,
}: {
  data: SettingsData | null;
  user: SettingsUser | null;
}) {
  // useAuth lets us refresh user state after sign-out transitions and
  // detect sign-in transitions (the unauth card's SignInDialog calls
  // onSignedIn → hard reload → RSC re-fetches server-side data).
  const { user: clientUser, loading, signOut } = useAuth();

  // Effective user: prefer client-side state once it's loaded, fall back to
  // server-side state for the initial paint.
  const user = clientUser ?? serverUser;

  // Local mutable copies of the BYOK + API keys so client-side mutations
  // (save / test / remove / create / revoke) update the view instantly. We
  // initialize from the server-provided `data` prop (RSC fetch). The RSC
  // only runs once per navigation; there's no path that re-passes `data`
  // after mount, so we don't need to sync (no cascading renders —
  // react-hooks/set-state-in-effect).
  const [byok, setByok] = useState<Record<SettingsByokProvider, SettingsByokMeta>>(
    data?.byok ?? {
      gratisfy: { provider: "gratisfy", connected: false, masked: "", addedAt: "" },
      g4f: { provider: "g4f", connected: false, masked: "", addedAt: "" },
    },
  );
  const [apiKeys, setApiKeys] = useState<SettingsApiKeyInfo[]>(data?.apiKeys ?? []);

  // Loading state — only renders if we're authed on the client but the server
  // said we're not (transitional state during initial sign-in).
  if (loading && !user && !serverUser) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // Not authed — render the sign-in card.
  if (!user) {
    return <SettingsSignInCard />;
  }

  // If we have a user but no data (e.g. server fetch failed), still render
  // the tabs with empty state so the user can see the structure.
  const safeData: SettingsData = data ?? {
    byok: {
      gratisfy: { provider: "gratisfy", connected: false, masked: "", addedAt: "" },
      g4f: { provider: "g4f", connected: false, masked: "", addedAt: "" },
    },
    apiKeys: [],
    balance: null,
    transactions: [],
    usage: [],
    providers: [],
    unifiedModelsCount: 0,
    catalogStale: false,
  };

  const accountUser: SettingsUser = {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerified ?? false,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  };

  return (
    <div className="flex flex-col gap-6 min-w-0">
      {/* ─── Header ─────────────────────────────────────────────────── */}
      <header className="flex flex-col gap-2 min-w-0">
        <div className="flex items-baseline justify-between gap-3 flex-wrap min-w-0">
          <h1 className="text-2xl sm:text-3xl font-normal tracking-tight text-foreground">
            Settings
          </h1>
          <span
            className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            signed in as <span className="font-mono">{user.email}</span>
          </span>
        </div>
        <p className="text-sm text-muted-foreground max-w-3xl min-w-0">
          Manage your account, BYOK keys, API keys, XYZ usage, theme
          preferences, and live provider diagnostics. Every control on this
          page is wired to a real, functional endpoint — no fake states.
        </p>
      </header>

      <Tabs defaultValue="account" className="min-w-0">
        <div className="overflow-x-auto -mx-1 px-1 pb-1 min-w-0">
          <TabsList className="w-full sm:w-auto inline-flex">
            <TabsTrigger value="account" className="gap-1.5">
              <User className="h-4 w-4" />
              <span>Account</span>
            </TabsTrigger>
            <TabsTrigger value="byok" className="gap-1.5">
              <Plug className="h-4 w-4" />
              <span>BYOK</span>
            </TabsTrigger>
            <TabsTrigger value="api-keys" className="gap-1.5">
              <KeyRound className="h-4 w-4" />
              <span>API Keys</span>
            </TabsTrigger>
            <TabsTrigger value="usage" className="gap-1.5">
              <Sparkles className="h-4 w-4" />
              <span>Usage</span>
            </TabsTrigger>
            <TabsTrigger value="preferences" className="gap-1.5">
              <SettingsIcon className="h-4 w-4" />
              <span>Preferences</span>
            </TabsTrigger>
            <TabsTrigger value="diagnostics" className="gap-1.5">
              <Server className="h-4 w-4" />
              <span>Diagnostics</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="account">
          <AccountSection user={accountUser} onSignOut={signOut} />
        </TabsContent>

        <TabsContent value="byok">
          <ByokSection initialByok={byok} />
        </TabsContent>

        <TabsContent value="api-keys">
          <ApiKeysSection initial={apiKeys} onChanged={setApiKeys} />
        </TabsContent>

        <TabsContent value="usage">
          <UsageSection
            initialBalance={safeData.balance}
            initialTransactions={safeData.transactions}
            initialUsage={safeData.usage}
          />
        </TabsContent>

        <TabsContent value="preferences">
          <PreferencesSection initialProviders={safeData.providers} />
        </TabsContent>

        <TabsContent value="diagnostics">
          <DiagnosticsSection
            initialProviders={safeData.providers}
            unifiedModelsCount={safeData.unifiedModelsCount}
            catalogStale={safeData.catalogStale}
          />
        </TabsContent>
      </Tabs>

      <Separator />

      <p className="text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap">
        <ChevronDown className="h-3 w-3" />
        <span>
          Endpoints:{" "}
          <code className="font-mono">/api/v1/byok/{`{gratisfy,g4f}`}</code>,{" "}
          <code className="font-mono">/api/v1/api-keys</code>,{" "}
          <code className="font-mono">/api/v1/xyz/{`{balance,transactions,usage}`}</code>,{" "}
          <code className="font-mono">/api/discovery/refresh</code>.
        </span>
      </p>
    </div>
  );
}

"use client";

/**
 * ByokProviders — BYOK management surface (PRD §4, §5, §54, §63).
 *
 * Two side-by-side cards (Gratisfy + G4F). Each card manages its own key:
 *   - Input (password) + Save (POST /api/v1/byok/<src>)
 *   - Test  (POST /api/v1/byok/<src>/test)   — shows "{count} models visible"
 *   - Remove(DELETE /api/v1/byok/<src>)
 *
 * Top of the page has a [Refresh Models] button that re-fetches
 * /api/v1/providers (re-runs discovery).
 *
 * DISPLAY RULES:
 *   - Source badges: NATIVE=slate, GRATISFY=violet, G4F=orange.
 *   - Append "BYOK" where requiresApiKey.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { RefreshCw, KeyRound, Trash2, CheckCircle2, XCircle } from "lucide-react";
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

type ByokSource = "gratisfy" | "g4f";

interface SaveMeta {
  provider: string;
  connected: boolean;
  masked: string;
  addedAt: string;
}

interface SaveResponse {
  ok: boolean;
  meta?: SaveMeta;
}

interface TestResponse {
  ok: boolean;
  error?: string;
  count?: number;
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

function ByokCard({ source }: { source: ByokSource }) {
  const isGratisfy = source === "gratisfy";
  const label = isGratisfy ? "Gratisfy" : "G4F";
  const base = `/api/v1/byok/${source}`;
  const testEndpoint = `${base}/test`;

  const [keyInput, setKeyInput] = useState("");
  const [masked, setMasked] = useState<string | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [removing, setRemoving] = useState(false);

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
      } else {
        toast.error(`Failed to save ${label} key`);
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
        if (typeof data.count === "number") {
          toast.success(`${data.count} models visible`);
        } else {
          toast.success(`${label} key valid`);
        }
      } else {
        setConnected(false);
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
        setMasked(null);
        setConnected(false);
        setKeyInput("");
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

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2 flex-wrap">
          <CardTitle className="text-base">{label}</CardTitle>
          <Badge
            className={
              isGratisfy
                ? "border-transparent bg-violet-500/15 text-violet-700 dark:text-violet-300"
                : "border-transparent bg-orange-500/15 text-orange-700 dark:text-orange-300"
            }
          >
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
        <CardDescription>
          {isGratisfy
            ? "Bring your own gxyz-… key from Gratisfy. We store it masked at rest."
            : "Bring your own g4f_… key from g4f.dev."}
        </CardDescription>
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
            placeholder={isGratisfy ? "gxyz-…" : "g4f_…"}
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
  const [providers, setProviders] = useState<ProviderEntry[] | null>(null);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Providers</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Connect your own BYOK keys (Gratisfy, G4F) and browse the unified
            provider catalog.
          </p>
        </div>
        <Button onClick={refresh} disabled={refreshing} variant="outline">
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Refreshing…" : "Refresh Models"}
        </Button>
      </div>

      <Separator />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ByokCard source="gratisfy" />
        <ByokCard source="g4f" />
      </div>

      <Separator />

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Unified catalog</h2>
        <p className="text-xs text-muted-foreground">
          {loading
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

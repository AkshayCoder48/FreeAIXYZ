"use client";

/**
 * /docs — FreeAIXYZ REST API reference (PRD §64, §65).
 *
 * Documents ONLY real, implemented endpoints (PRD §5, §8–§14, §34–§57,
 * §62, §73, §74, §75, §76). Removed legacy references: OnyxBase, Telegram
 * DB, fake endpoints, old providers, old auth methods.
 *
 * Layout: sticky sidebar nav (collapsible Sheet on mobile) + main content
 * with endpoint cards, code blocks, and "Try it" buttons that copy a
 * cURL example. Mobile-first responsive 320 → 1440px+. Sticky footer.
 */

import { useSyncExternalStore, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Check,
  Copy,
  Menu,
  Terminal,
  KeyRound,
  Plug,
  Shuffle,
  Boxes,
  DollarSign,
  Coins,
  MessageSquare,
  AlertTriangle,
  BookOpen,
  ChevronRight,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
} from "@/components/ui/sheet";
import { Nav } from "@/components/nav";
import { SiteFooter } from "@/components/site";
import { toast } from "sonner";

// ─── useOrigin (client-only window.location.origin) ─────────────────────────
const emptySubscribe = () => () => {};

function useOrigin() {
  return useSyncExternalStore(
    emptySubscribe,
    () => window.location.origin,
    () => "https://your-host",
  );
}

// ─── Section registry ───────────────────────────────────────────────────────
const SECTIONS = [
  { id: "api-keys", label: "API Keys", icon: KeyRound, color: "text-violet-600" },
  { id: "byok", label: "BYOK Providers", icon: Plug, color: "text-amber-600" },
  { id: "routing", label: "Provider Routing", icon: Shuffle, color: "text-slate-700 dark:text-slate-300" },
  { id: "models", label: "Models", icon: Boxes, color: "text-slate-700 dark:text-slate-300" },
  { id: "pricing", label: "Pricing", icon: DollarSign, color: "text-amber-600" },
  { id: "xyz", label: "XYZ Credits", icon: Coins, color: "text-violet-600" },
  { id: "chat", label: "Chat Completions", icon: MessageSquare, color: "text-emerald-600" },
  { id: "errors", label: "Errors", icon: AlertTriangle, color: "text-rose-600" },
] as const;

// ─── HTTP method badge colors ──────────────────────────────────────────────
type Method = "GET" | "POST" | "DELETE" | "PUT";

const METHOD_STYLES: Record<Method, string> = {
  GET: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  POST: "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30",
  DELETE: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",
  PUT: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
};

function MethodBadge({ method }: { method: Method }) {
  return (
    <Badge
      variant="outline"
      className={`font-mono text-[10px] font-bold tracking-wider px-2 py-0.5 rounded-sm border ${METHOD_STYLES[method]}`}
      style={{ fontFamily: "var(--font-mono), monospace" }}
    >
      {method}
    </Badge>
  );
}

// ─── Copy button ────────────────────────────────────────────────────────────
function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="absolute top-2 right-2 h-7 gap-1 text-xs text-muted-foreground hover:text-foreground"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          toast.success("Copied to clipboard");
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("Copy failed");
        }
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : label}
    </Button>
  );
}

// ─── Code block (slate chrome, no indigo/blue) ──────────────────────────────
function CodeBlock({
  code,
  filename = "snippet",
  language = "bash",
}: {
  code: string;
  filename?: string;
  language?: string;
}) {
  return (
    <div className="relative rounded-md border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950/50 overflow-hidden">
      <div className="flex items-center gap-1.5 px-4 py-2 border-b border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900/60">
        <span className="h-2.5 w-2.5 rounded-full bg-slate-400/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-slate-400/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-slate-500" />
        <span
          className="ml-2 text-[11px] text-slate-600 dark:text-slate-400"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          {filename}
        </span>
        <span className="ml-auto text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-500">
          {language}
        </span>
      </div>
      <pre
        className="overflow-x-auto p-4 text-[12.5px] leading-relaxed text-slate-700 dark:text-slate-200 max-h-[460px] overflow-y-auto"
        style={{ fontFamily: "var(--font-mono), monospace" }}
      >
        <code>{code}</code>
      </pre>
      <CopyButton text={code} />
    </div>
  );
}

// ─── Endpoint card ──────────────────────────────────────────────────────────
function EndpointCard({
  method,
  path,
  title,
  description,
  children,
  curl,
}: {
  method: Method;
  path: string;
  title: string;
  description: string;
  children?: ReactNode;
  curl: string;
}) {
  return (
    <Card id={path.replace(/[^a-zA-Z0-9]/g, "-").slice(1)} className="border-slate-200 dark:border-slate-800">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start gap-3">
          <MethodBadge method={method} />
          <code
            className="text-[13px] text-slate-800 dark:text-slate-100 break-all"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            {path}
          </code>
        </div>
        <CardTitle className="text-base mt-2 text-foreground">{title}</CardTitle>
        <CardDescription className="text-[13px] text-muted-foreground leading-relaxed">
          {description}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        {children}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Terminal className="h-3.5 w-3.5 text-slate-500" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Try it
            </span>
          </div>
          <CodeBlock code={curl} filename="curl.sh" language="bash" />
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Section wrapper ────────────────────────────────────────────────────────
function Section({
  id,
  index,
  title,
  icon: Icon,
  intro,
  children,
}: {
  id: string;
  index: number;
  title: string;
  icon: typeof KeyRound;
  intro: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <div className="flex items-center gap-3 mb-3">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <Icon className="h-4 w-4 text-slate-700 dark:text-slate-300" />
        </span>
        <div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
            §{String(index).padStart(2, "0")}
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">
            {title}
          </h2>
        </div>
      </div>
      <div className="text-[14px] leading-relaxed text-muted-foreground mb-6">
        {intro}
      </div>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

// ─── Source badge ───────────────────────────────────────────────────────────
const SOURCE_BADGES: Record<string, { label: string; className: string }> = {
  native: { label: "native", className: "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30" },
  gratisfy: { label: "gratisfy", className: "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30" },
  g4f: { label: "g4f", className: "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30" },
};

function SourceBadge({ source }: { source: string }) {
  const cfg = SOURCE_BADGES[source] ?? SOURCE_BADGES.native;
  return (
    <Badge variant="outline" className={`font-mono text-[10px] ${cfg.className}`}>
      {cfg.label}
    </Badge>
  );
}

// ─── Sidebar nav (desktop sticky) ──────────────────────────────────────────
function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Documentation sections" className="space-y-1">
      {SECTIONS.map((s, i) => {
        const Icon = s.icon;
        return (
          <a
            key={s.id}
            href={`#${s.id}`}
            onClick={onNavigate}
            className="group flex items-center gap-3 rounded-md px-3 py-2 text-[13px] text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          >
            <Icon className={`h-3.5 w-3.5 ${s.color}`} />
            <span className="flex-1">{s.label}</span>
            <span className="text-[10px] font-mono text-slate-400">
              §{String(i + 1).padStart(2, "0")}
            </span>
            <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
          </a>
        );
      })}
      <Separator className="my-3" />
      <Link
        href="/chat"
        onClick={onNavigate}
        className="group flex items-center gap-3 rounded-md px-3 py-2 text-[13px] text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
      >
        <MessageSquare className="h-3.5 w-3.5 text-emerald-600" />
        <span className="flex-1">Open Playground</span>
      </Link>
    </nav>
  );
}

// ─── Page shell ─────────────────────────────────────────────────────────────
export default function DocsPage() {
  const origin = useOrigin();
  const [mobileOpen, setMobileOpen] = useState(false);

  // cURL templates use ${origin} so the user can copy and run them directly.
  const listKeysCurl = `curl ${origin}/api/v1/api-keys \\
  -H "Authorization: Bearer fx_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxx"`;

  const createKeyCurl = `curl -X POST ${origin}/api/v1/api-keys \\
  -H "Authorization: Bearer fx_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{ "name": "production", "scopes": ["chat", "models"] }'`;

  const revokeKeyCurl = `curl -X DELETE ${origin}/api/v1/api-keys/\${KEY_ID} \\
  -H "Authorization: Bearer fx_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxx"`;

  const saveGratisfyCurl = `curl -X POST ${origin}/api/v1/byok/gratisfy \\
  -H "Cookie: fxz_session=\${SESSION_COOKIE}" \\
  -H "Content-Type: application/json" \\
  -d '{ "key": "gratisfy_xxxxxxxxxxxx" }'`;

  const testGratisfyCurl = `curl -X POST ${origin}/api/v1/byok/gratisfy/test \\
  -H "Cookie: fxz_session=\${SESSION_COOKIE}" \\
  -H "Content-Type: application/json" \\
  -d '{}'`;

  const removeGratisfyCurl = `curl -X DELETE ${origin}/api/v1/byok/gratisfy \\
  -H "Cookie: fxz_session=\${SESSION_COOKIE}"`;

  const modelsListCurl = `curl ${origin}/api/v1/models`;

  const unifiedModelsCurl = `curl ${origin}/api/v1/models/unified \\
  -H "Authorization: Bearer fx_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxx"`;

  const providersCurl = `curl ${origin}/api/v1/providers \\
  -H "Authorization: Bearer fx_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxx"`;

  const pricingCurl = `curl ${origin}/api/v1/pricing`;

  const balanceCurl = `curl ${origin}/api/v1/xyz/balance \\
  -H "Authorization: Bearer fx_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxx"`;

  const transactionsCurl = `curl "${origin}/api/v1/xyz/transactions?limit=50" \\
  -H "Authorization: Bearer fx_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxx"`;

  const usageCurl = `curl "${origin}/api/v1/xyz/usage?limit=50" \\
  -H "Authorization: Bearer fx_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxx"`;

  const chatCurl = `curl -N ${origin}/api/v1/chat/completions \\
  -H "Authorization: Bearer fx_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "native:tb:gpt-5",
    "messages": [
      { "role": "system", "content": "You are a helpful assistant." },
      { "role": "user", "content": "Hello!" }
    ],
    "stream": true,
    "temperature": 0.7
  }'`;

  const chatPython = `from openai import OpenAI

client = OpenAI(
    base_url="${origin}/api/v1",
    api_key="fx_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxx",
)

stream = client.chat.completions.create(
    model="native:tb:gpt-5",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Hello!"},
    ],
    stream=True,
)
for chunk in stream:
    delta = chunk.choices[0].delta.content
    if delta:
        print(delta, end="", flush=True)`;

  const chatNode = `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${origin}/api/v1",
  apiKey: process.env.FREEAIXYZ_API_KEY, // fx_live_*
});

const stream = await client.chat.completions.create({
  model: "native:tb:gpt-5",
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Hello!" },
  ],
  stream: true,
});
for await (const chunk of stream) {
  const delta = chunk.choices[0]?.delta?.content;
  if (delta) process.stdout.write(delta);
}`;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Nav />

      {/* Page header */}
      <header className="border-b border-border bg-background/60 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8 sm:py-12">
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <Badge
              variant="outline"
              className="bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/30 font-mono text-[10px]"
            >
              v1
            </Badge>
            <Badge
              variant="outline"
              className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 font-mono text-[10px]"
            >
              stable
            </Badge>
            <span className="text-[12px] text-muted-foreground font-mono">
              base URL: <code className="text-foreground">{origin}/api/v1</code>
            </span>
          </div>
          <h1
            className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground"
            style={{ fontFamily: "var(--font-display), Georgia, serif" }}
          >
            FreeAIXYZ API Reference
          </h1>
          <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-muted-foreground">
            OpenAI-compatible AI gateway with dynamic model discovery, BYOK
            (Bring-Your-Own-Key) for Gratisfy and G4F, and a unified XYZ credit
            system. Every endpoint listed here is live in production. No fake
            examples, no removed providers, no dead routes.
          </p>
        </div>
      </header>

      {/* Body: sidebar + content */}
      <div className="flex-1 mx-auto max-w-7xl w-full px-4 sm:px-6 py-8 sm:py-12">
        <div className="grid lg:grid-cols-[240px_minmax(0,1fr)] gap-8 lg:gap-12">
          {/* Sidebar (sticky on desktop, sheet on mobile) */}
          <aside className="hidden lg:block">
            <div className="sticky top-24">
              <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-3 px-3">
                Contents
              </div>
              <SidebarNav />
            </div>
          </aside>

          {/* Mobile sidebar (Sheet) */}
          <div className="lg:hidden mb-4">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <Menu className="h-4 w-4" />
                  Sections
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 p-6 overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                  <SheetTitle className="text-sm font-mono uppercase tracking-wider">
                    Contents
                  </SheetTitle>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setMobileOpen(false)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <SidebarNav onNavigate={() => setMobileOpen(false)} />
              </SheetContent>
            </Sheet>
          </div>

          {/* Main content */}
          <main className="min-w-0 space-y-16">
            {/* 1. API Keys */}
            <Section
              id="api-keys"
              index={1}
              title="FreeAIXYZ API Keys"
              icon={KeyRound}
              intro={
                <>
                  Issue <code className="font-mono text-foreground">fx_live_*</code>{" "}
                  bearer keys for programmatic access. Keys are stored as
                  SHA-256 hashes — the full key is shown <strong>exactly once</strong>{" "}
                  at creation, never retrievable afterward. The first 12 chars
                  (<code className="font-mono text-foreground">keyPrefix</code>)
                  are kept in plaintext for UI identification. Scopes are an
                  array of strings (default: <code className="font-mono">["chat","models"]</code>).
                </>
              }
            >
              <div className="rounded-md border border-amber-300/50 dark:border-amber-700/40 bg-amber-50 dark:bg-amber-950/20 p-4">
                <div className="flex gap-3">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <div className="text-[13px] text-amber-800 dark:text-amber-200 leading-relaxed">
                    Treat every <code className="font-mono">fx_live_*</code> key like a
                    password. Anyone with it can call the API as you. Revoke
                    immediately if it leaks. The full key is shown once, at
                    creation — store it in a secrets manager.
                  </div>
                </div>
              </div>

              <EndpointCard
                method="GET"
                path="/api/v1/api-keys"
                title="List your keys"
                description="Auth required. Returns masked keys — never the full secret. Revoked keys remain in the list (soft-delete pattern, retained for audit) and show `revokedAt`."
                curl={listKeysCurl}
              >
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                    200 response
                  </div>
                  <CodeBlock
                    code={`{
  "keys": [
    {
      "id": "clxxx...",
      "name": "production",
      "keyPrefix": "fx_live_ab",
      "scopes": ["chat", "models"],
      "lastUsedAt": "2024-01-01T00:00:00.000Z",
      "revokedAt": null,
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}`}
                    filename="response.json"
                    language="json"
                  />
                </div>
              </EndpointCard>

              <EndpointCard
                method="POST"
                path="/api/v1/api-keys"
                title="Create a key"
                description="Auth required. Returns the full `fx_live_*` key EXACTLY ONCE in `key.key`. After this response, the full key is unrecoverable."
                curl={createKeyCurl}
              >
                <div className="space-y-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                      Request body (all optional)
                    </div>
                    <CodeBlock
                      code={`{
  "name": "production",            // optional, max 64 chars, default "default"
  "scopes": ["chat", "models"]     // optional, default ["chat","models"]
}`}
                      filename="request.json"
                      language="json"
                    />
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                      201 response — full key shown only here
                    </div>
                    <CodeBlock
                      code={`{
  "key": {
    "id": "clxxx...",
    "name": "production",
    "keyPrefix": "fx_live_ab",
    "scopes": ["chat", "models"],
    "lastUsedAt": null,
    "revokedAt": null,
    "createdAt": "2024-01-01T00:00:00.000Z",
    "key": "fx_live_abcdefghijklmnopqrstuvwxyz0123456789"
  }
}`}
                      filename="response.json"
                      language="json"
                    />
                  </div>
                </div>
              </EndpointCard>

              <EndpointCard
                method="DELETE"
                path="/api/v1/api-keys/{id}"
                title="Revoke a key (soft)"
                description="Auth required. Soft-revokes — the row stays for audit, but `revokedAt` is set and the key hash no longer authenticates."
                curl={revokeKeyCurl}
              >
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                    200 response
                  </div>
                  <CodeBlock
                    code={`{ "ok": true }`}
                    filename="response.json"
                    language="json"
                  />
                </div>
              </EndpointCard>

              <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 p-4">
                <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-2">
                  Header convention
                </div>
                <p className="text-[13px] text-muted-foreground mb-3">
                  Either header works on every authenticated route. The SDK-style{" "}
                  <code className="font-mono text-foreground">Authorization: Bearer</code>{" "}
                  form is preferred.
                </p>
                <CodeBlock
                  code={`# Preferred — OpenAI-compatible
Authorization: Bearer fx_live_xxxxxxxxxxxx

# Legacy / explicit form
X-API-Key: fx_live_xxxxxxxxxxxx`}
                  filename="headers.txt"
                />
              </div>
            </Section>

            {/* 3. BYOK */}
            <Section
              id="byok"
              index={3}
              title="BYOK — Bring Your Own Key"
              icon={Plug}
              intro={
                <>
                  Save and validate upstream provider keys (Gratisfy, G4F).
                  Keys are encrypted at rest (AES-256-GCM). The raw key is{" "}
                  <strong>never</strong> returned after save — only a masked
                  preview. Every "Connected" badge reflects a real validation
                  round-trip against the upstream (no fake status).
                </>
              }
            >
              <div className="rounded-md border border-violet-300/50 dark:border-violet-700/40 bg-violet-50 dark:bg-violet-950/20 p-4">
                <div className="flex gap-3">
                  <Plug className="h-4 w-4 text-violet-600 shrink-0 mt-0.5" />
                  <div className="text-[13px] text-violet-800 dark:text-violet-200 leading-relaxed">
                    <strong>PRD §10:</strong> Never send the BYOK key with chat
                    generation requests. The server resolves it from the
                    authenticated user's stored (encrypted) credential. The
                    client only sends the model id — FreeAIXYZ looks up the
                    right key for the source.
                  </div>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="rounded-md border border-violet-300/50 dark:border-violet-700/40 bg-violet-50 dark:bg-violet-950/20 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <SourceBadge source="gratisfy" />
                    <span className="text-[13px] font-semibold text-foreground">Gratisfy</span>
                  </div>
                  <p className="text-[12px] text-muted-foreground leading-relaxed">
                    Multi-provider gateway. BYOK key unlocks the entire Gratisfy
                    catalog (multi-model, multi-provider).
                  </p>
                </div>
                <div className="rounded-md border border-orange-300/50 dark:border-orange-700/40 bg-orange-50 dark:bg-orange-950/20 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <SourceBadge source="g4f" />
                    <span className="text-[13px] font-semibold text-foreground">G4F</span>
                  </div>
                  <p className="text-[12px] text-muted-foreground leading-relaxed">
                    Aggregator (multiple upstream providers per key). BYOK key
                    unlocks the G4F catalog.
                  </p>
                </div>
              </div>

              <EndpointCard
                method="POST"
                path="/api/v1/byok/gratisfy"
                title="Save + validate a Gratisfy key"
                description="Auth required. Saves (encrypted) → validates against upstream → triggers dynamic model discovery. Returns masked meta + validation result + modelsDiscovered count."
                curl={saveGratisfyCurl}
              >
                <div className="space-y-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                      Request body
                    </div>
                    <CodeBlock
                      code={`{ "key": "gratisfy_xxxxxxxxxxxx" }`}
                      filename="request.json"
                      language="json"
                    />
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                      200 response (success)
                    </div>
                    <CodeBlock
                      code={`{
  "ok": true,
  "meta": {
    "provider": "gratisfy",
    "keyPreview": "grat•••••••••••••xyz",
    "validatedAt": "2024-01-01T00:00:00.000Z",
    "validationOk": true
  },
  "modelsDiscovered": 42
}`}
                      filename="response.json"
                      language="json"
                    />
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                      400 response (invalid key)
                    </div>
                    <CodeBlock
                      code={`{
  "ok": false,
  "error": "Invalid API key.",
  "meta": { /* ...masked meta... */ }
}`}
                      filename="response.json"
                      language="json"
                    />
                  </div>
                </div>
              </EndpointCard>

              <EndpointCard
                method="POST"
                path="/api/v1/byok/g4f"
                title="Save + validate a G4F key"
                description="Auth required. Same shape as the Gratisfy endpoint, against the G4F upstream."
                curl={`curl -X POST ${origin}/api/v1/byok/g4f \\
  -H "Cookie: fxz_session=\${SESSION_COOKIE}" \\
  -H "Content-Type: application/json" \\
  -d '{ "key": "g4f_xxxxxxxxxxxx" }'`}
              >
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                    200 response (success)
                  </div>
                  <CodeBlock
                    code={`{
  "ok": true,
  "meta": { /* masked preview + validation */ },
  "modelsDiscovered": 18
}`}
                    filename="response.json"
                    language="json"
                  />
                </div>
              </EndpointCard>

              <EndpointCard
                method="POST"
                path="/api/v1/byok/gratisfy/test"
                title="Re-test the saved Gratisfy key"
                description="Auth required. Body `{key?: string}` — if `key` provided, test THAT; else test the stored key. Marks validation result on the stored credential. No fake 'Connected' badge — validation is a real round-trip."
                curl={testGratisfyCurl}
              >
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                    200 response
                  </div>
                  <CodeBlock
                    code={`{ "ok": true }`}
                    filename="response.json"
                    language="json"
                  />
                </div>
              </EndpointCard>

              <EndpointCard
                method="POST"
                path="/api/v1/byok/g4f/test"
                title="Re-test the saved G4F key"
                description="Auth required. Same shape as the Gratisfy /test endpoint, against the G4F upstream."
                curl={`curl -X POST ${origin}/api/v1/byok/g4f/test \\
  -H "Cookie: fxz_session=\${SESSION_COOKIE}" \\
  -H "Content-Type: application/json" \\
  -d '{}'`}
              >
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                    200 response
                  </div>
                  <CodeBlock
                    code={`{ "ok": true }`}
                    filename="response.json"
                    language="json"
                  />
                </div>
              </EndpointCard>

              <EndpointCard
                method="DELETE"
                path="/api/v1/byok/gratisfy"
                title="Remove the Gratisfy key"
                description="Auth required. Hard-deletes the stored encrypted credential. Discovered BYOK models are no longer accessible to this user."
                curl={removeGratisfyCurl}
              >
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                    200 response
                  </div>
                  <CodeBlock
                    code={`{ "ok": true }`}
                    filename="response.json"
                    language="json"
                  />
                </div>
              </EndpointCard>

              <EndpointCard
                method="DELETE"
                path="/api/v1/byok/g4f"
                title="Remove the G4F key"
                description="Auth required. Same shape as the Gratisfy DELETE, for the G4F credential."
                curl={`curl -X DELETE ${origin}/api/v1/byok/g4f \\
  -H "Cookie: fxz_session=\${SESSION_COOKIE}"`}
              >
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                    200 response
                  </div>
                  <CodeBlock
                    code={`{ "ok": true }`}
                    filename="response.json"
                    language="json"
                  />
                </div>
              </EndpointCard>
            </Section>

            {/* 4. Provider Routing */}
            <Section
              id="routing"
              index={4}
              title="Provider Routing"
              icon={Shuffle}
              intro={
                <>
                  The central principle of FreeAIXYZ: every chat request is
                  routed by the model id. The user sends a{" "}
                  <code className="font-mono text-foreground">fx_live_*</code> key
                  (or session cookie) + a model id. FreeAIXYZ:
                </>
              }
            >
              <ol className="list-decimal list-inside space-y-2 text-[14px] text-foreground/90">
                <li>Authenticates the user (session cookie OR <code className="font-mono">fx_live_*</code> bearer).</li>
                <li>Resolves the model id to a <strong>source</strong> + <strong>provider</strong> + <strong>model</strong> triple.</li>
                <li>Looks up the user's stored (encrypted) BYOK credential for that source — only for <code className="font-mono">gratisfy</code> / <code className="font-mono">g4f</code> sources. Native models are served by the platform itself.</li>
                <li>Calls the upstream adapter.</li>
                <li>Normalizes the response into the OpenAI shape (deltas for streaming, full choice objects for non-streaming).</li>
                <li>Deducts XYZ (if applicable). Native / G4F / Gratisfy BYOK all have their own cost rules — BYOK has a zero platform XYZ charge because the user's upstream pays.</li>
              </ol>

              <div>
                <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-2">
                  Model id format
                </div>
                <CodeBlock
                  code={`<source>:<provider>:<model>

# Native (no BYOK needed — platform-served)
native:tb:gpt-5
native:po:gpt-4o
native:oc:big-pickle

# G4F BYOK — unlocks after POST /api/v1/byok/g4f
g4f:Airforce:gpt-4
g4f:Blackbox:llama-3.1-70b

# Gratisfy BYOK — unlocks after POST /api/v1/byok/gratisfy
gratisfy:gratisfy:gemini-2.5-flash`}
                  filename="model-ids.txt"
                />
              </div>

              <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 p-4 space-y-3">
                <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500">
                  Source legend
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  <SourceBadge source="native" />
                  <span className="text-muted-foreground">
                    — served by the platform. No upstream credential needed.
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  <SourceBadge source="gratisfy" />
                  <span className="text-muted-foreground">
                    — multi-provider gateway. Requires a saved BYOK key.
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  <SourceBadge source="g4f" />
                  <span className="text-muted-foreground">
                    — aggregator. Requires a saved BYOK key.
                  </span>
                </div>
              </div>
            </Section>

            {/* 5. Models API */}
            <Section
              id="models"
              index={5}
              title="Models API"
              icon={Boxes}
              intro={
                <>
                  Three list endpoints, all OpenAI-shaped. The basic{" "}
                  <code className="font-mono text-foreground">/models</code>{" "}
                  is the OpenAI SDK drop-in;{" "}
                  <code className="font-mono text-foreground">/models/unified</code>{" "}
                  adds source/provider/pricing/capabilities;{" "}
                  <code className="font-mono text-foreground">/providers</code>{" "}
                  groups models by provider.
                </>
              }
            >
              <EndpointCard
                method="GET"
                path="/api/v1/models"
                title="OpenAI-compatible model list"
                description="Public. OpenAI shape ({object: 'list', data: [...]}). Lists every DiscoveredModel with a registered adapter that is not in offline status. Use this with the OpenAI SDK."
                curl={modelsListCurl}
              >
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                    200 response
                  </div>
                  <CodeBlock
                    code={`{
  "object": "list",
  "data": [
    {
      "id": "native:tb:gpt-5",
      "object": "model",
      "created": 1700000000,
      "owned_by": "toolbaz"
    }
  ]
}`}
                    filename="response.json"
                    language="json"
                  />
                </div>
              </EndpointCard>

              <EndpointCard
                method="GET"
                path="/api/v1/models/unified"
                title="Unified model list (extended)"
                description="Auth OPTIONAL. Gratisfy models are only included when the caller has a connected key (per-user discovery is auth-gated). Same model from different sources stays independent."
                curl={unifiedModelsCurl}
              >
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                    200 response
                  </div>
                  <CodeBlock
                    code={`{
  "object": "list",
  "data": [
    {
      "id": "native:tb:gpt-5",
      "object": "model",
      "source": "native",
      "provider": "tb",
      "displayName": "GPT-5",
      "originalModelId": "gpt-5",
      "streaming": true,
      "available": true,
      "capabilities": {
        "text": true,
        "vision": false,
        "audio": false,
        "video": false,
        "image": false,
        "reasoning": true,
        "webSearch": false,
        "streaming": true
      },
      "pricing": {
        "inputPerMillion": 5,
        "outputPerMillion": 15,
        "cachePerMillion": null,
        "currency": "USD",
        "status": "documented",
        "source": "provider"
      }
    }
  ],
  "stale": false
}`}
                    filename="response.json"
                    language="json"
                  />
                </div>
              </EndpointCard>

              <EndpointCard
                method="GET"
                path="/api/v1/providers"
                title="Provider list"
                description="Auth OPTIONAL. Groups models by provider. Gratisfy providers are only included when the caller has a connected key."
                curl={providersCurl}
              >
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                    200 response
                  </div>
                  <CodeBlock
                    code={`{
  "providers": [
    {
      "id": "tb",
      "name": "Toolbaz",
      "source": "native",
      "requiresApiKey": false,
      "supportsModelDiscovery": true,
      "supportsStreaming": true,
      "capabilities": { "text": true, "vision": false },
      "modelCount": 12,
      "lastDiscoveredAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "stale": false
}`}
                    filename="response.json"
                    language="json"
                  />
                </div>
              </EndpointCard>
            </Section>

            {/* 6. Pricing */}
            <Section
              id="pricing"
              index={6}
              title="Pricing"
              icon={DollarSign}
              intro={
                <>
                  Centralized pricing board. Sources of truth (in priority
                  order): <strong>provider</strong> (upstream explicitly priced) →{" "}
                  <strong>market</strong> (baseline from the pricing board) →{" "}
                  <strong>manual</strong> → <strong>undocumented</strong> (cannot
                  establish a reliable price). Never confuse "$0" with "not
                  documented" — the <code className="font-mono">status</code>{" "}
                  field makes the distinction explicit.
                </>
              }
            >
              <EndpointCard
                method="GET"
                path="/api/v1/pricing"
                title="Pricing board"
                description="Public. Returns version, multiplier, reference request, and the full per-model pricing map keyed by model id."
                curl={pricingCurl}
              >
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                    200 response (truncated)
                  </div>
                  <CodeBlock
                    code={`{
  "version": 1,
  "currency": "USD",
  "multiplier": 1,
  "referenceRequest": {
    "inputTokens": 1200,
    "outputTokens": 800
  },
  "updatedAt": "2024-01-01T00:00:00.000Z",
  "models": {
    "native:tb:gpt-5": {
      "inputPerMillion": 5,
      "outputPerMillion": 15,
      "cachePerMillion": null,
      "currency": "USD",
      "status": "documented",
      "source": "provider"
    },
    "native:po:gpt-4o": {
      "inputPerMillion": 2.5,
      "outputPerMillion": 10,
      "cachePerMillion": 1.25,
      "currency": "USD",
      "status": "documented",
      "source": "provider"
    }
  }
}`}
                    filename="response.json"
                    language="json"
                  />
                </div>
              </EndpointCard>
            </Section>

            {/* 7. XYZ */}
            <Section
              id="xyz"
              index={7}
              title="XYZ Credits"
              icon={Coins}
              intro={
                <>
                  1 XYZ ≈ $1 USD of model usage at multiplier=1 (configurable via
                  <code className="font-mono text-foreground"> XYZ_USD_MULTIPLIER</code>).
                  Daily +1 XYZ grant (idempotent per UTC day — hitting{" "}
                  <code className="font-mono">/xyz/balance</code> repeatedly
                  within the same UTC day only grants once). Native / G4F
                  requests deduct XYZ; <strong>BYOK requests have a zero
                  platform XYZ charge</strong> — the user's upstream pays.
                </>
              }
            >
              <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 p-4 space-y-2">
                <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500">
                  Cost formulas
                </div>
                <CodeBlock
                  code={`# USD cost (PRD §35)
usdCost = (in/1e6) * inputPrice
        + (out/1e6) * outputPrice
        + (cache/1e6) * cachePrice

# XYZ cost (PRD §36)
xyzCost = usdCost * multiplier     # multiplier = 1 currently

# BYOK: platform XYZ charge = 0
#       (user's upstream provider handles billing)`}
                  filename="formulas.txt"
                />
              </div>

              <EndpointCard
                method="GET"
                path="/api/v1/xyz/balance"
                title="Balance + idempotent daily grant"
                description="Auth required. Returns the user's current balance + grants the daily +1 XYZ if not already granted today (UTC). The `granted` flag tells the client whether this request triggered a fresh grant."
                curl={balanceCurl}
              >
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                    200 response
                  </div>
                  <CodeBlock
                    code={`{
  "balance": {
    "xyzBalance": "4.82",
    "lifetimeEarned": "127.00",
    "lifetimeSpent": "122.18",
    "lastDailyGrantAt": "2024-01-01T00:00:00.000Z"
  },
  "granted": true
}`}
                    filename="response.json"
                    language="json"
                  />
                </div>
              </EndpointCard>

              <EndpointCard
                method="GET"
                path="/api/v1/xyz/transactions"
                title="Immutable ledger"
                description="Auth required. `?limit=50` (max 500). Append-only XYZ ledger — every DAILY_GRANT, GENERATION, REFUND, ADMIN_ADJUSTMENT is recorded forever."
                curl={transactionsCurl}
              >
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                    200 response (truncated)
                  </div>
                  <CodeBlock
                    code={`{
  "transactions": [
    {
      "id": "clxxx...",
      "type": "DAILY_GRANT",
      "amount": "+1.0000",
      "balanceAfter": "4.8200",
      "model": null,
      "provider": null,
      "source": null,
      "note": "Daily +1 grant",
      "createdAt": "2024-01-01T00:00:00.000Z"
    },
    {
      "id": "clxxx...",
      "type": "GENERATION",
      "amount": "-0.0123",
      "balanceAfter": "3.8200",
      "model": "native:tb:gpt-5",
      "provider": "tb",
      "source": "native",
      "note": "chat completion",
      "createdAt": "2024-01-01T00:00:01.000Z"
    }
  ]
}`}
                    filename="response.json"
                    language="json"
                  />
                </div>
              </EndpointCard>

              <EndpointCard
                method="GET"
                path="/api/v1/xyz/usage"
                title="Usage records"
                description="Auth required. `?limit=50` (max 500). Per-call token usage + USD/XYZ cost, with the pricing board version used at the time of the call."
                curl={usageCurl}
              >
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                    200 response (truncated)
                  </div>
                  <CodeBlock
                    code={`{
  "usage": [
    {
      "id": "clxxx...",
      "model": "native:tb:gpt-5",
      "provider": "tb",
      "source": "native",
      "inputTokens": 124,
      "outputTokens": 312,
      "cacheTokens": 0,
      "usdCost": "0.0053",
      "xyzCost": "0.0053",
      "pricingVersion": 1,
      "createdAt": "2024-01-01T00:00:01.000Z"
    }
  ]
}`}
                    filename="response.json"
                    language="json"
                  />
                </div>
              </EndpointCard>
            </Section>

            {/* 8. Chat */}
            <Section
              id="chat"
              index={8}
              title="Chat Completions"
              icon={MessageSquare}
              intro={
                <>
                  OpenAI-compatible. Drop the FreeAIXYZ base URL into the OpenAI
                  SDK and pass any model id from <code className="font-mono">/models</code>.
                  Streaming is true SSE — every upstream delta is forwarded
                  immediately as an OpenAI-shaped chunk (no buffering, no
                  re-pacing). Non-streaming providers return one content chunk
                  + stop — honestly, not fake-streamed.
                </>
              }
            >
              <EndpointCard
                method="POST"
                path="/api/v1/chat/completions"
                title="Chat completion"
                description="Auth required (session cookie OR `fx_live_*` bearer). OpenAI-shaped body. Streaming uses SSE: `data: {chunk}\\n\\n` per delta, `data: [DONE]\\n\\n` at the end. Errors are normalized JSON — provider failures NEVER crash the client."
                curl={chatCurl}
              >
                <div className="space-y-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                      Request body
                    </div>
                    <CodeBlock
                      code={`{
  "model": "native:tb:gpt-5",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Hello!" }
  ],
  "stream": true,
  "temperature": 0.7,
  "max_tokens": 1024,
  "top_p": 1
}`}
                      filename="request.json"
                      language="json"
                    />
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                      Streaming SSE response
                    </div>
                    <CodeBlock
                      code={`data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1700000000,"model":"native:tb:gpt-5","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1700000000,"model":"native:tb:gpt-5","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1700000000,"model":"native:tb:gpt-5","choices":[{"index":0,"delta":{"content":"!"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1700000000,"model":"native:tb:gpt-5","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]

`}
                      filename="stream.sse"
                      language="sse"
                    />
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                      Python SDK
                    </div>
                    <CodeBlock
                      code={chatPython}
                      filename="main.py"
                      language="python"
                    />
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                      Node.js SDK
                    </div>
                    <CodeBlock
                      code={chatNode}
                      filename="index.js"
                      language="javascript"
                    />
                  </div>
                </div>
              </EndpointCard>

              <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 p-4">
                <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-2">
                  Streaming contract
                </div>
                <ul className="space-y-1.5 text-[13px] text-muted-foreground list-disc list-inside">
                  <li><code className="font-mono">Content-Type: text/event-stream</code></li>
                  <li>Each chunk is a single OpenAI-shaped JSON object prefixed with <code className="font-mono">data: </code> and suffixed with two newlines.</li>
                  <li>Terminal chunk: <code className="font-mono">data: [DONE]</code></li>
                  <li>The adapter normalizes upstream deltas into a unified SSE event stream — provider-agnostic.</li>
                  <li>Non-streaming upstreams return one content chunk + a stop delta (honest, not fake-streamed).</li>
                </ul>
              </div>
            </Section>

            {/* 9. Errors */}
            <Section
              id="errors"
              index={9}
              title="Errors"
              icon={AlertTriangle}
              intro={
                <>
                  Every API request gets a{" "}
                  <code className="font-mono text-foreground">request_id</code>{" "}
                  (format <code className="font-mono">fxreq_...</code>) — emit it
                  in your logs so we can correlate across the gateway and the
                  upstream. Provider failures NEVER crash the client — they
                  return a normalized JSON envelope.
                </>
              }
            >
              <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 p-4">
                <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-3">
                  Error types
                </div>
                <div className="grid sm:grid-cols-2 gap-2 text-[12px]">
                  {[
                    ["authentication_error", "No valid session or fx_live_* key."],
                    ["authorization_error", "Authed but not allowed (e.g. revoked key, suspended user)."],
                    ["invalid_request_error", "Bad body — missing model, malformed messages, etc."],
                    ["provider_error", "Upstream rejected the request (auth, rate limit, 5xx, etc.)."],
                    ["rate_limit_error", "Too many requests. Honors Retry-After header."],
                    ["not_found", "Resource (model id, API key id) doesn't exist."],
                    ["internal_error", "Unexpected server-side failure."],
                  ].map(([type, desc]) => (
                    <div key={type} className="rounded-md border border-slate-200 dark:border-slate-800 bg-background p-2.5">
                      <code className="text-[11px] font-mono text-rose-700 dark:text-rose-300">{type}</code>
                      <p className="text-[12px] text-muted-foreground mt-1 leading-snug">{desc}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-2">
                  Sample error response
                </div>
                <CodeBlock
                  code={`{
  "error": {
    "type": "provider_error",
    "code": "UPSTREAM_ERROR",
    "source": "gratisfy",
    "provider": "gratisfy",
    "model": "gratisfy:gratisfy:gpt-4",
    "message": "Upstream rejected request (HTTP 401). Invalid API key.",
    "retryable": false,
    "request_id": "fxreq_01J..."
  }
}`}
                  filename="error.json"
                  language="json"
                />
              </div>

              <div className="rounded-md border border-amber-300/50 dark:border-amber-700/40 bg-amber-50 dark:bg-amber-950/20 p-4">
                <div className="flex gap-3">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <div className="text-[13px] text-amber-800 dark:text-amber-200 leading-relaxed">
                    When you contact support, include the{" "}
                    <code className="font-mono">request_id</code>. It is the
                    single fastest path to a root-cause.
                  </div>
                </div>
              </div>
            </Section>

            {/* Outro */}
            <section className="pt-8 border-t border-border">
              <div className="flex items-start gap-3">
                <BookOpen className="h-5 w-5 text-slate-500 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-base font-semibold text-foreground">
                    That's everything.
                  </h3>
                  <p className="mt-1 text-[13px] text-muted-foreground leading-relaxed">
                    Every endpoint documented here is live in production. Removed
                    references: OnyxBase, Telegram DB, fake endpoints, old
                    providers, old authentication methods. If something doesn't
                    behave as documented, attach the{" "}
                    <code className="font-mono">request_id</code> and reach out.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link href="/chat">
                      <Button variant="outline" size="sm">
                        Open Playground
                      </Button>
                    </Link>
                    <Link href="/pricing">
                      <Button variant="outline" size="sm">
                        Pricing Board
                      </Button>
                    </Link>
                    <Link href="/models">
                      <Button variant="outline" size="sm">
                        Browse Models
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>
            </section>
          </main>
        </div>
      </div>

      <SiteFooter />
    </div>
  );
}

"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { motion } from "framer-motion";
import {
  Settings as SettingsIcon,
  Check,
  ExternalLink,
  ArrowLeft,
  Server,
  Key,
  Save,
  Loader2,
  Eye,
  EyeOff,
  ShieldCheck,
  AlertCircle,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { toast } from "sonner";

// ─── API key storage ────────────────────────────────────────────────────────
const API_KEYS_STORAGE_KEY = "freeaixyz_api_keys";

interface StoredApiKeys {
  zai: string;
  openrouter: string;
  groq: string;
}

const EMPTY_KEYS: StoredApiKeys = { zai: "", openrouter: "", groq: "" };

function loadApiKeys(): StoredApiKeys {
  if (typeof window === "undefined") return EMPTY_KEYS;
  try {
    const raw = localStorage.getItem(API_KEYS_STORAGE_KEY);
    if (!raw) return EMPTY_KEYS;
    const parsed = JSON.parse(raw) as Partial<StoredApiKeys>;
    return {
      zai: parsed.zai ?? "",
      openrouter: parsed.openrouter ?? "",
      groq: parsed.groq ?? "",
    };
  } catch {
    return EMPTY_KEYS;
  }
}

function saveApiKeys(keys: StoredApiKeys) {
  if (typeof window === "undefined") return;
  localStorage.setItem(API_KEYS_STORAGE_KEY, JSON.stringify(keys));
}

// ─── Provider meta ──────────────────────────────────────────────────────────
interface ProviderMeta {
  field: keyof StoredApiKeys;
  header: string;
  name: string;
  testModel: string;
  instructions: string;
  link: { href: string; label: string };
  placeholder: string;
}

const PROVIDERS: ProviderMeta[] = [
  {
    field: "zai",
    header: "x-zai-token",
    name: "Z.AI (GLM models)",
    testModel: "zai-glm-5-turbo",
    instructions:
      "Go to chat.z.ai, log in, open DevTools → Application → Local Storage → token",
    link: { href: "https://chat.z.ai", label: "chat.z.ai" },
    placeholder: "eyJhbGciOi... (JWT from local storage)",
  },
  {
    field: "openrouter",
    header: "x-openrouter-key",
    name: "OpenRouter (GPT-5, Claude, Gemini)",
    testModel: "or-gemini-3-5-flash",
    instructions: "Go to openrouter.ai/keys and create a key",
    link: { href: "https://openrouter.ai/keys", label: "openrouter.ai/keys" },
    placeholder: "sk-or-v1-...",
  },
  {
    field: "groq",
    header: "x-groq-key",
    name: "Groq (Llama, GPT-OSS)",
    testModel: "groq-llama-3-3-70b",
    instructions: "Go to console.groq.com/keys and create a key",
    link: { href: "https://console.groq.com/keys", label: "console.groq.com/keys" },
    placeholder: "gsk_...",
  },
];

// ─── Page ───────────────────────────────────────────────────────────────────

const emptySubscribe = () => () => {};
function useMounted() {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}

export default function SettingsPage() {
  const mounted = useMounted();
  const [keys, setKeys] = useState<StoredApiKeys>(EMPTY_KEYS);
  const [showKey, setShowKey] = useState<Record<keyof StoredApiKeys, boolean>>({
    zai: false,
    openrouter: false,
    groq: false,
  });
  const [testing, setTesting] = useState<Record<keyof StoredApiKeys, boolean>>({
    zai: false,
    openrouter: false,
    groq: false,
  });

  // Load from localStorage after mount (avoids SSR hydration mismatch)
  useEffect(() => {
    setKeys(loadApiKeys());
  }, []);

  function handleSave() {
    saveApiKeys(keys);
    toast.success("API keys saved to your browser");
  }

  function handleClear(field: keyof StoredApiKeys) {
    const next = { ...keys, [field]: "" };
    setKeys(next);
    saveApiKeys(next);
    toast.success(`${PROVIDERS.find((p) => p.field === field)?.name} key cleared`);
  }

  async function handleTest(meta: ProviderMeta) {
    const value = keys[meta.field].trim();
    if (!value) {
      toast.error(`Add your ${meta.name} key first`);
      return;
    }
    setTesting((prev) => ({ ...prev, [meta.field]: true }));
    try {
      const res = await fetch("/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [meta.header]: value,
        },
        body: JSON.stringify({
          model: meta.testModel,
          messages: [{ role: "user", content: 'Reply with the single word: "ok"' }],
          stream: false,
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.choices?.[0]?.message?.content) {
        const content = String(data.choices[0].message.content).slice(0, 80);
        toast.success(`✓ ${meta.name} key works. Reply: "${content}"`);
      } else if (res.status === 401) {
        toast.error(
          `${meta.name} key was rejected: ${data?.error?.message ?? "Unauthorized"}`,
        );
      } else {
        const msg = data?.error?.message ?? `HTTP ${res.status}`;
        toast.error(`${meta.name} test failed: ${msg}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      toast.error(`${meta.name} test failed: ${msg}`);
    } finally {
      setTesting((prev) => ({ ...prev, [meta.field]: false }));
    }
  }

  return (
    <div className="relative min-h-screen flex flex-col bg-background">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          backgroundImage:
            "radial-gradient(60% 50% at 50% 0%, rgba(255,154,60,0.10), transparent 70%)",
        }}
      />

      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Button asChild variant="ghost" size="sm" className="gap-1.5">
              <Link href="/">
                <ArrowLeft className="h-4 w-4" /> Back
              </Link>
            </Button>
            <div className="h-5 w-px bg-border" />
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-[#ff9a3c]/10 border border-[#ff9a3c]/30 flex items-center justify-center">
                <SettingsIcon className="h-4 w-4 text-[#ff9a3c]" />
              </div>
              <span className="text-sm font-semibold">Settings</span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto max-w-4xl w-full px-4 sm:px-6 py-10 space-y-8">
        {/* API Keys header banner */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-[#ff9a3c]/30 bg-[#ff9a3c]/5 p-6 space-y-3"
        >
          <div className="flex items-center gap-2">
            <Key className="h-5 w-5 text-[#ff9a3c]" />
            <h2 className="text-lg font-semibold">API Keys</h2>
            <Badge
              variant="outline"
              className="ml-1 border-[#ff9a3c]/30 text-[#ff9a3c] bg-[#ff9a3c]/5 text-[10px]"
            >
              BYOK
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Some models (Z.AI GLM, OpenRouter, Groq) require your own API key.
            Keys are stored <strong>only</strong> in your browser&apos;s
            localStorage and sent directly to the upstream provider through the
            gateway proxy — they never touch our database.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Badge variant="outline" className="border-[#ff9a3c]/30 text-[#ff9a3c] bg-[#ff9a3c]/5">
              <ShieldCheck className="h-3 w-3 mr-1" />
              Client-side storage
            </Badge>
            <Badge variant="outline" className="border-[#ff9a3c]/30 text-[#ff9a3c] bg-[#ff9a3c]/5">
              9 gated models
            </Badge>
            <Badge variant="outline" className="border-[#ff9a3c]/30 text-[#ff9a3c] bg-[#ff9a3c]/5">
              3 providers
            </Badge>
          </div>
        </motion.div>

        {/* API Key Inputs */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-2xl border border-border bg-card/50 backdrop-blur p-6 space-y-5"
        >
          <h2 className="text-lg font-semibold">Provider Keys</h2>

          {!mounted ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : (
            <div className="space-y-5">
              {PROVIDERS.map((meta) => {
                const value = keys[meta.field];
                const isSet = value.trim().length > 0;
                const isVisible = showKey[meta.field];
                const isTesting = testing[meta.field];
                return (
                  <div
                    key={meta.field}
                    className="rounded-xl border border-border bg-background/40 p-4 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Label
                          htmlFor={`key-${meta.field}`}
                          className="text-sm font-medium flex items-center gap-2"
                        >
                          {meta.name}
                          {isSet ? (
                            <Badge
                              variant="outline"
                              className="border-[#ff9a3c]/30 text-[#ff9a3c] bg-[#ff9a3c]/5 text-[10px]"
                            >
                              <Check className="h-3 w-3 mr-1" />
                              configured
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="border-muted-foreground/20 text-muted-foreground text-[10px]"
                            >
                              not set
                            </Badge>
                          )}
                        </Label>
                        <p className="text-xs text-muted-foreground mt-1">
                          {meta.instructions}
                        </p>
                        <a
                          href={meta.link.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-[#ff9a3c] hover:underline mt-1"
                        >
                          {meta.link.label}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                      <code className="text-[10px] font-mono text-muted-foreground/70 shrink-0 bg-muted/30 border border-border/50 rounded px-1.5 py-0.5">
                        {meta.header}
                      </code>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Input
                          id={`key-${meta.field}`}
                          type={isVisible ? "text" : "password"}
                          value={value}
                          onChange={(e) =>
                            setKeys((prev) => ({
                              ...prev,
                              [meta.field]: e.target.value,
                            }))
                          }
                          placeholder={meta.placeholder}
                          autoComplete="off"
                          spellCheck={false}
                          className="pr-10 font-mono text-xs h-10 bg-background"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setShowKey((prev) => ({
                              ...prev,
                              [meta.field]: !prev[meta.field],
                            }))
                          }
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1"
                          aria-label={isVisible ? "Hide key" : "Show key"}
                        >
                          {isVisible ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleTest(meta)}
                        disabled={isTesting || !isSet}
                        className="h-10 gap-1.5"
                      >
                        {isTesting ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Zap className="h-3.5 w-3.5" />
                        )}
                        Test
                      </Button>
                      {isSet && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleClear(meta.field)}
                          className="h-10 text-muted-foreground hover:text-foreground"
                        >
                          Clear
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-border/50">
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5" />
              Keys are stored in localStorage under <code className="font-mono">freeaixyz_api_keys</code>
            </p>
            <Button
              onClick={handleSave}
              className="bg-[#ff9a3c] hover:bg-[#f08820] text-[#000000] gap-1.5"
            >
              <Save className="h-4 w-4" />
              Save keys
            </Button>
          </div>
        </motion.div>

        {/* Free models info */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="rounded-2xl border border-[#ff9a3c]/30 bg-[#ff9a3c]/5 p-6 space-y-3"
        >
          <div className="flex items-center gap-2">
            <Check className="h-5 w-5 text-[#ff9a3c]" />
            <h2 className="text-lg font-semibold">No key required for free models</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            All other models across 10 free providers work without any user
            authentication. The gateway handles token rotation, identity
            generation, and API key management automatically. Add a key above
            only if you want to use Z.AI, OpenRouter, or Groq models.
          </p>
          <div className="flex flex-wrap gap-2 pt-2">
            <Badge variant="outline" className="border-[#ff9a3c]/30 text-[#ff9a3c] bg-[#ff9a3c]/5">
              Web Search: automatic
            </Badge>
            <Badge variant="outline" className="border-[#ff9a3c]/30 text-[#ff9a3c] bg-[#ff9a3c]/5">
              Music Gen: automatic
            </Badge>
            <Badge variant="outline" className="border-[#ff9a3c]/30 text-[#ff9a3c] bg-[#ff9a3c]/5">
              Free LLMs: no signup
            </Badge>
          </div>
        </motion.div>

        {/* Provider Status Overview */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="rounded-2xl border border-border bg-card/50 backdrop-blur p-6 space-y-3"
        >
          <h2 className="text-lg font-semibold">Provider Status</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {[
              { name: "Toolbaz", models: 18, auth: "Token rotation" },
              { name: "HeckAI", models: 7, auth: "None" },
              { name: "Kilo Code", models: 9, auth: "None" },
              { name: "Web Search", models: 2, auth: "Auto (Google)" },
              { name: "SurfSense", models: 2, auth: "None" },
              { name: "UnlimitedAI", models: 2, auth: "None" },
              { name: "LLM7.io", models: 2, auth: "None" },
              { name: "NSFWLover", models: 1, auth: "Random x-local-id" },
              { name: "JollyGen", models: 1, auth: "Random guest_hash" },
              { name: "Pollinations", models: 1, auth: "None" },
              { name: "Z.AI", models: 4, auth: "Your JWT (BYOK)" },
              { name: "OpenRouter", models: 3, auth: "Your API key (BYOK)" },
              { name: "Groq", models: 2, auth: "Your API key (BYOK)" },
            ].map((p) => (
              <div key={p.name} className="flex items-center justify-between rounded-lg border border-border bg-background/40 px-3 py-2">
                <div>
                  <span className="text-sm font-medium">{p.name}</span>
                  <span className="text-[10px] text-muted-foreground block">{p.auth}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{p.models} models</span>
                  <Badge
                    variant="outline"
                    className="border-[#ff9a3c]/30 text-[#ff9a3c] bg-[#ff9a3c]/5 text-[9px]"
                  >
                    active
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Music Generation Info */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="rounded-2xl border border-border bg-card/50 backdrop-blur p-6 space-y-3"
        >
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Server className="h-5 w-5 text-[#ff9a3c]" /> Music Generation
          </h2>
          <p className="text-sm text-muted-foreground">
            AI music generation via ACE-Step 1.5 is available at:
          </p>
          <code className="block text-xs text-[#ff9a3c] bg-[#ff9a3c]/5 border border-[#ff9a3c]/15 rounded-md px-3 py-2">
            POST /api/v1/music/generate
          </code>
          <p className="text-xs text-muted-foreground">
            Params: prompt, lyrics, duration, language, instrumental, bpm, key, seed, sampleMode, batchSize.
            The API key is auto-fetched per request — no user input needed.
          </p>
        </motion.div>

        <div className="flex justify-center">
          <Button asChild variant="outline" className="gap-1.5">
            <Link href="/models">
              View all models <ExternalLink className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </main>

      <footer className="mt-auto border-t border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 py-6">
          <span className="text-xs text-muted-foreground">
            FreeAIXYZ Gateway · BYOK support for Z.AI, OpenRouter, Groq
          </span>
        </div>
      </footer>
    </div>
  );
}

"use client";

import { useState, useSyncExternalStore } from "react";
import { motion } from "framer-motion";
import {
  Settings as SettingsIcon,
  Key,
  Check,
  Eye,
  EyeOff,
  ExternalLink,
  ArrowLeft,
  Server,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { toast } from "sonner";

const emptySubscribe = () => () => {};
function useLocalStorage(key: string, defaultValue: string = "") {
  const isClient = useSyncExternalStore(emptySubscribe, () => true, () => false);
  // Read from localStorage synchronously on client to avoid effect-based setState
  const [value, setValue] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(key) ?? defaultValue;
    }
    return defaultValue;
  });

  const update = (val: string) => {
    setValue(val);
    if (isClient) {
      localStorage.setItem(key, val);
    }
  };

  return [value, update] as const;
}

export default function SettingsPage() {
  const [lmarenaToken, setLmarenaToken] = useLocalStorage("lmarena_token", "");
  const [showToken, setShowToken] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSaved(true);
    toast.success("Settings saved!");
    setTimeout(() => setSaved(false), 2000);
  };

  const handleClear = () => {
    setLmarenaToken("");
    toast.success("LMArena token cleared");
  };

  return (
    <div className="relative min-h-screen flex flex-col bg-background">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          backgroundImage:
            "radial-gradient(60% 50% at 50% 0%, rgba(16,185,129,0.10), transparent 70%)",
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
              <div className="h-7 w-7 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
                <SettingsIcon className="h-4 w-4 text-emerald-400" />
              </div>
              <span className="text-sm font-semibold">Settings</span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto max-w-4xl w-full px-4 sm:px-6 py-10 space-y-8">
        {/* LMArena Token */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-border bg-card/50 backdrop-blur p-6 space-y-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Server className="h-5 w-5 text-emerald-400" />
                <h2 className="text-lg font-semibold">LMArena Auth Token</h2>
                <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-400 bg-emerald-500/5">
                  arena prod v1
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                Enter your LMArena (arena.ai) authentication token to unlock 50+ premium models
                including GPT-5, Claude Opus, Gemini Pro, and more. The token is stored locally
                in your browser and never sent to any server except arena.ai.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Key className="h-3.5 w-3.5" /> Auth Token
            </Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showToken ? "text" : "password"}
                  value={lmarenaToken}
                  onChange={(e) => setLmarenaToken(e.target.value)}
                  placeholder="Paste your LMArena token here..."
                  className="pr-10 font-mono text-sm"
                />
                <button
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button
                onClick={handleSave}
                className="bg-emerald-600 hover:bg-emerald-500 text-white gap-1.5"
              >
                {saved ? <Check className="h-4 w-4" /> : null}
                {saved ? "Saved" : "Save"}
              </Button>
            </div>
          </div>

          {lmarenaToken && (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="gap-1 border-emerald-500/30 text-emerald-400 bg-emerald-500/5">
                <Check className="h-3 w-3" /> Token set
              </Badge>
              <Button variant="ghost" size="sm" onClick={handleClear} className="text-xs text-muted-foreground">
                Clear token
              </Button>
            </div>
          )}

          {/* Instructions */}
          <div className="rounded-xl border border-border/60 bg-background/40 p-4 space-y-2">
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5" /> How to get your token (3 methods):
            </p>
            <div className="space-y-3 mt-2">
              <div>
                <p className="text-xs font-medium text-emerald-400">Method 1 — Full Cookie header (recommended):</p>
                <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside ml-1 mt-1">
                  <li>Visit <a href="https://arena.ai" target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline inline-flex items-center gap-0.5">arena.ai <ExternalLink className="h-3 w-3" /></a> and sign in</li>
                  <li>Open DevTools (F12) → Network tab</li>
                  <li>Send a chat message on arena.ai</li>
                  <li>Find the <code className="text-emerald-400">create-evaluation</code> request</li>
                  <li>Copy the entire <code className="text-emerald-400">Cookie</code> header value</li>
                  <li>Paste it above and click Save</li>
                </ol>
              </div>
              <div>
                <p className="text-xs font-medium text-emerald-400">Method 2 — Supabase session cookie:</p>
                <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside ml-1 mt-1">
                  <li>DevTools → Application → Cookies → arena.ai</li>
                  <li>Copy the value of <code className="text-emerald-400">sb-huogzoeqzcrdvkwtvodi-auth-token</code></li>
                </ol>
              </div>
              <div>
                <p className="text-xs font-medium text-emerald-400">Method 3 — Raw JWT:</p>
                <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside ml-1 mt-1">
                  <li>Copy the <code className="text-emerald-400">Authorization</code> header from any arena.ai request</li>
                  <li>Paste just the JWT (starts with <code className="text-emerald-400">eyJ</code>)</li>
                </ol>
              </div>
            </div>
          </div>

          <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-3">
            <p className="text-[11px] text-amber-400/80">
              Your token is stored only in your browser's localStorage. It's sent directly to
              arena.ai when you use LMArena models. We never log or store it server-side.
            </p>
          </div>
        </motion.div>

        {/* Provider Status Overview */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-2xl border border-border bg-card/50 backdrop-blur p-6 space-y-3"
        >
          <h2 className="text-lg font-semibold">Provider Status</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {[
              { name: "Toolbaz", models: 19, status: "active", auth: "Token rotation" },
              { name: "GPT4Free", models: 20, status: "active", auth: "None (96 providers)" },
              { name: "Kilo Code", models: 10, status: "active", auth: "None" },
              { name: "Pollinations", models: 1, status: "active", auth: "None" },
              { name: "SurfSense", models: 2, status: "active", auth: "None" },
              { name: "UnlimitedAI", models: 2, status: "active", auth: "None" },
              { name: "NSFWLover", models: 1, status: "active", auth: "Random x-local-id" },
              { name: "JollyGen", models: 1, status: "active", auth: "Random guest_hash" },
              { name: "LLM7.io", models: 3, status: "active", auth: "None" },
              { name: "LMArena", models: lmarenaToken ? "50+" : 0, status: lmarenaToken ? "active" : "needs token", auth: "User token" },
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
                    className={
                      p.status === "active"
                        ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/5 text-[9px]"
                        : "border-amber-500/30 text-amber-400 bg-amber-500/5 text-[9px]"
                    }
                  >
                    {p.status === "active" ? "active" : "setup"}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
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
            FreeGPT Gateway · Settings stored locally in your browser
          </span>
        </div>
      </footer>
    </div>
  );
}

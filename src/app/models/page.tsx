import type { Metadata } from "next";
import { ModelsShowcase } from "@/components/landing/models-showcase";
import { MODELS, PROVIDER_INFO, type ProviderId } from "@/lib/providers";
import { Badge } from "@/components/ui/badge";
import { Server, Cpu, Zap, ArrowLeft, ExternalLink, Terminal } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "All Models — FreeGPT Gateway",
  description:
    "Browse all 24 free AI models across 5 providers. Filter by capability (streaming, tools, vision), category, and provider.",
};

export default function ModelsPage() {
  const providerList = Object.keys(PROVIDER_INFO) as ProviderId[];
  const streamingCount = MODELS.filter((m) => m.capabilities.streaming).length;
  const toolsCount = MODELS.filter((m) => m.capabilities.tools).length;

  return (
    <div className="relative min-h-screen flex flex-col bg-background">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          backgroundImage:
            "radial-gradient(60% 50% at 50% 0%, rgba(44,224,128,0.10), transparent 70%)",
        }}
      />

      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Button asChild variant="ghost" size="sm" className="gap-1.5">
              <Link href="/">
                <ArrowLeft className="h-4 w-4" /> Back
              </Link>
            </Button>
            <div className="h-5 w-px bg-border" />
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-[#ff9a3c]/10 border border-[#ff9a3c]/30 flex items-center justify-center">
                <Cpu className="h-4 w-4 text-[#ff9a3c]" />
              </div>
              <span className="text-sm font-semibold">All Models</span>
            </div>
          </div>
          <Badge
            variant="outline"
            className="gap-1.5 border-[#ff9a3c]/30 text-[#ff9a3c] bg-[#ff9a3c]/5"
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#ff9a3c]" />
            </span>
            {MODELS.length} models live
          </Badge>
        </div>
      </header>

      <main className="flex-1 mx-auto max-w-6xl w-full px-4 sm:px-6 py-10">
        {/* heading */}
        <div className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
            All available models
          </h1>
          <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
            {MODELS.length} free models across {providerList.length} providers.
            Every model accepts the OpenAI Chat Completions schema — point any
            OpenAI SDK at{" "}
            <code className="text-[#ff9a3c] text-xs">/api/v1</code> and use
            any id below.
          </p>
        </div>

        {/* stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          {[
            { icon: Cpu, label: "Models", value: MODELS.length },
            { icon: Server, label: "Providers", value: providerList.length },
            { icon: Zap, label: "Streaming", value: streamingCount },
            { icon: Cpu, label: "Tool calling", value: toolsCount },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-xl border border-border bg-card/40 backdrop-blur px-4 py-3"
            >
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <s.icon className="h-3.5 w-3.5" /> {s.label}
              </div>
              <div className="text-2xl font-bold text-[#ff9a3c] mt-1">
                {s.value}
              </div>
            </div>
          ))}
        </div>

        {/* providers overview */}
        <div className="mb-8 rounded-2xl border border-border bg-card/40 backdrop-blur p-5">
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Server className="h-4 w-4 text-[#ff9a3c]" /> Providers
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {providerList.map((pid) => {
              const info = PROVIDER_INFO[pid];
              const count = MODELS.filter((m) => m.provider === pid).length;
              return (
                <div
                  key={pid}
                  className="rounded-lg border border-border bg-background/40 p-3"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium">{info.name}</span>
                    <Badge variant="secondary" className="text-[10px]">
                      {count} model{count !== 1 ? "s" : ""}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    {info.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* searchable showcase */}
        <ModelsShowcase />

        {/* API quickstart */}
        <div className="mt-10 rounded-2xl border border-border bg-zinc-950/60 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/60 bg-zinc-900/40">
            <Terminal className="h-3.5 w-3.5 text-[#ff9a3c]" />
            <span className="text-[11px] text-muted-foreground font-mono">
              quickstart
            </span>
          </div>
          <pre className="overflow-x-auto p-4 text-[12.5px] leading-relaxed text-zinc-200 font-mono">
            <code>{`curl /api/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-5.4-mini",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'

# All model ids from the list above work drop-in.
# No API key required.`}</code>
          </pre>
        </div>

        <div className="mt-6 flex justify-center">
          <Button asChild variant="outline" className="gap-1.5">
            <Link href="/">
              <ArrowLeft className="h-4 w-4" /> Back to playground
            </Link>
          </Button>
        </div>
      </main>

      <footer className="mt-auto border-t border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            FreeGPT Gateway · {MODELS.length} models · {providerList.length}{" "}
            providers
          </span>
          <Link
            href="/"
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            Home <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      </footer>
    </div>
  );
}

import { Nav } from "@/components/nav";
import { ModelsShowcase } from "@/components/landing/models-showcase";
import { ImageModelsShowcase } from "@/components/landing/image-models-showcase";
import { MODELS, PROVIDER_INFO, type ProviderId } from "@/lib/providers";
import { IMAGE_MODELS, imageModelCounts } from "@/lib/providers/image-registry";
import { Badge } from "@/components/ui/badge";
import { Server, Cpu, Zap, Terminal, ImageIcon, ExternalLink, Sparkles, Layers, Globe } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function ModelsPage() {
  const providerList = Object.keys(PROVIDER_INFO) as ProviderId[];
  const textModels = MODELS.filter((m) => m.modality !== "text-to-image");
  const imageModelsCount = IMAGE_MODELS.length;
  const streamingCount = textModels.filter((m) => m.capabilities.streaming).length;
  const toolsCount = textModels.filter((m) => m.capabilities.tools).length;
  const imgCounts = imageModelCounts();

  return (
    <div className="relative min-h-screen flex flex-col bg-background overflow-hidden">
      {/* Background blobs */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute h-[55vh] w-[55vh] -top-[10%] -right-[10%] rounded-full bg-[#8B5CF6]/10 blur-3xl animate-clay-float" />
        <div className="absolute h-[50vh] w-[50vh] -left-[10%] top-[30%] rounded-full bg-[#EC4899]/10 blur-3xl animate-clay-float-delayed animation-delay-2000" />
        <div className="absolute h-[40vh] w-[40vh] bottom-[10%] right-[20%] rounded-full bg-[#0EA5E9]/10 blur-3xl animate-clay-float-slow animation-delay-4000" />
      </div>

      <Nav />

      <main className="flex-1 mx-auto max-w-6xl w-full px-4 sm:px-6 py-10">
        {/* heading */}
        <div className="mb-10">
          <h1
            className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight"
            style={{ fontFamily: "var(--font-brand), sans-serif" }}
          >
            Model{" "}
            <span className="text-primary">Catalog</span>
          </h1>
          <p
            className="text-base sm:text-lg text-muted-foreground mt-3 max-w-2xl leading-relaxed"
            style={{ fontFamily: "var(--font-body), sans-serif" }}
          >
            {textModels.length} free chat models across {providerList.length} text providers,
            plus <span className="text-primary font-semibold">{imageModelsCount} image models</span>.
            Every chat model accepts the OpenAI Chat Completions schema — point any
            OpenAI SDK at <code className="text-primary text-sm font-semibold">/api/v1</code>.
          </p>
        </div>

        {/* stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-5 mb-10">
          {[
            { icon: Cpu, label: "Chat models", value: textModels.length, color: "from-purple-400 to-purple-600" },
            { icon: ImageIcon, label: "Image models", value: imageModelsCount, color: "from-pink-400 to-pink-600" },
            { icon: Zap, label: "Streaming", value: streamingCount, color: "from-sky-400 to-sky-600" },
            { icon: Layers, label: "Tool calling", value: toolsCount, color: "from-emerald-400 to-emerald-600" },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-[32px] bg-white/60 dark:bg-[#2D2440]/60 backdrop-blur-xl px-5 py-5 shadow-clay-card hover:-translate-y-2 hover:shadow-clay-card-hover transition-all duration-500 border border-primary/5"
            >
              <div className={`h-9 w-9 rounded-full bg-gradient-to-br ${s.color} flex items-center justify-center mb-3 shadow-clay-button`}>
                <s.icon className="h-4 w-4 text-white" />
              </div>
              <div
                className="text-3xl font-black text-foreground"
                style={{ fontFamily: "var(--font-brand), sans-serif" }}
              >
                {s.value}
              </div>
              <div className="text-xs text-muted-foreground font-medium tracking-wide uppercase mt-1">
                {s.label}
              </div>
            </div>
          ))}
        </div>

        {/* providers overview */}
        <div className="mb-10 rounded-[32px] bg-white/60 dark:bg-[#2D2440]/60 backdrop-blur-xl p-6 shadow-clay-card border border-primary/5">
          <h2
            className="text-lg font-bold mb-4 flex items-center gap-2"
            style={{ fontFamily: "var(--font-brand), sans-serif" }}
          >
            <div className="h-8 w-8 rounded-2xl bg-gradient-to-br from-purple-400 to-purple-600 flex items-center justify-center shadow-clay-button">
              <Globe className="h-4 w-4 text-white" />
            </div>
            Providers
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {providerList.map((pid) => {
              const info = PROVIDER_INFO[pid];
              const count = textModels.filter((m) => m.provider === pid).length;
              return (
                <div
                  key={pid}
                  className="rounded-[24px] bg-white/40 dark:bg-[#2D2440]/40 p-4 shadow-clay-card hover:-translate-y-1 hover:shadow-clay-card-hover transition-all duration-300 border border-primary/5"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold" style={{ fontFamily: "var(--font-brand), sans-serif" }}>{info.name}</span>
                    <Badge variant="secondary" className="text-[10px] rounded-[16px]">
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

        {/* Image models section */}
        <div className="mt-16 mb-10" id="image-models">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-pink-400 to-pink-600 flex items-center justify-center shadow-clay-button">
              <ImageIcon className="h-5 w-5 text-white" />
            </div>
            <h2
              className="text-2xl sm:text-3xl font-extrabold tracking-tight"
              style={{ fontFamily: "var(--font-brand), sans-serif" }}
            >
              Image Models
            </h2>
          </div>
          <p className="text-base text-muted-foreground mb-5 max-w-2xl leading-relaxed">
            {imageModelsCount} text-to-image models.
            Generate via <code className="text-primary text-sm font-semibold">POST /api/v1/image/generate</code>{" "}
            with <code className="text-primary text-sm font-semibold">&#123; prompt, model &#125;</code>.
          </p>
          <div className="flex flex-wrap items-center gap-2 mb-8">
            <Badge variant="outline" className="gap-1 text-pink-500 border-pink-500/30 bg-pink-500/5 rounded-[20px]">Anime: {imgCounts.anime}</Badge>
            <Badge variant="outline" className="gap-1 text-sky-500 border-sky-500/30 bg-sky-500/5 rounded-[20px]">Realism: {imgCounts.realism}</Badge>
            <Badge variant="outline" className="gap-1 text-purple-500 border-purple-500/30 bg-purple-500/5 rounded-[20px]">Mixed: {imgCounts.mixed}</Badge>
            <Badge variant="outline" className="gap-1 text-primary border-primary/30 bg-primary/5 rounded-[20px]">General: {imgCounts.general}</Badge>
            <Button asChild variant="ghost" size="sm" className="ml-auto gap-1.5 rounded-[20px] hover:-translate-y-0.5 transition-all duration-200">
              <Link href="/docs#image-generation">
                <Terminal className="h-3.5 w-3.5" /> API docs
              </Link>
            </Button>
          </div>
          <ImageModelsShowcase />
        </div>

        {/* API quickstart */}
        <div className="mt-12 rounded-[32px] bg-white/60 dark:bg-[#2D2440]/60 backdrop-blur-xl shadow-clay-card overflow-hidden border border-primary/5">
          <div className="flex items-center gap-2 px-5 py-3 border-b border-primary/10 bg-primary/5">
            <Terminal className="h-4 w-4 text-primary" />
            <span className="text-xs text-muted-foreground font-medium" style={{ fontFamily: "var(--font-code), monospace" }}>
              quickstart
            </span>
          </div>
          <pre className="overflow-x-auto p-5 text-[13px] leading-relaxed text-foreground/80 font-mono" style={{ fontFamily: "var(--font-code), monospace" }}>
            <code>{`curl /api/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-5.4-mini",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'

# All model ids work drop-in.
# No API key required.`}</code>
          </pre>
        </div>
      </main>

      <footer className="mt-auto border-t border-primary/5 bg-white/40 dark:bg-[#1A1625]/40 backdrop-blur-xl">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6 flex items-center justify-between">
          <span className="text-xs text-muted-foreground font-medium">
            FreeAI4All · {textModels.length} chat + {imageModelsCount} image models · {providerList.length} providers
          </span>
          <Link
            href="/"
            className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 hover:-translate-y-0.5 transition-all duration-200"
          >
            Home <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      </footer>
    </div>
  );
}

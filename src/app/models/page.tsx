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
      <Nav />

      <main className="flex-1 mx-auto max-w-6xl w-full px-4 sm:px-6 py-10">
        {/* heading */}
        <div className="mb-10">
          <h1
            className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight text-foreground"
            style={{ fontFamily: "var(--font-brand), serif" }}
          >
            Model Catalog
          </h1>
          <p
            className="text-base sm:text-lg text-muted-foreground mt-3 max-w-2xl leading-relaxed"
            style={{ fontFamily: "var(--font-body), serif" }}
          >
            {textModels.length} free chat models across {providerList.length} text providers,
            plus {imageModelsCount} image models.
            Every chat model accepts the OpenAI Chat Completions schema — point any
            OpenAI SDK at{" "}
            <code
              className="text-foreground text-sm font-semibold"
              style={{ fontFamily: "var(--font-code), monospace" }}
            >
              /api/v1
            </code>.
          </p>
        </div>

        {/* stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-5 mb-10">
          {[
            { icon: Cpu, label: "Chat models", value: textModels.length },
            { icon: ImageIcon, label: "Image models", value: imageModelsCount },
            { icon: Zap, label: "Streaming", value: streamingCount },
            { icon: Layers, label: "Tool calling", value: toolsCount },
          ].map((s) => (
            <div
              key={s.label}
              className="border border-foreground p-6 hover:bg-foreground hover:text-background transition-colors duration-100"
            >
              <div className="h-9 w-9 border border-foreground flex items-center justify-center mb-3 hover:border-background">
                <s.icon className="h-4 w-4" />
              </div>
              <div
                className="text-3xl font-black text-foreground"
                style={{ fontFamily: "var(--font-brand), serif" }}
              >
                {s.value}
              </div>
              <div
                className="text-xs text-muted-foreground font-medium tracking-wide uppercase mt-1"
                style={{ fontFamily: "var(--font-code), monospace" }}
              >
                {s.label}
              </div>
            </div>
          ))}
        </div>

        {/* providers overview */}
        <div className="mb-10 border border-foreground p-6">
          <h2
            className="text-lg font-bold mb-4 flex items-center gap-2 text-foreground"
            style={{ fontFamily: "var(--font-brand), serif" }}
          >
            <div className="h-8 w-8 border border-foreground flex items-center justify-center">
              <Globe className="h-4 w-4" />
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
                  className="border border-foreground p-4 hover:bg-foreground hover:text-background transition-colors duration-100"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span
                      className="text-sm font-bold text-foreground"
                      style={{ fontFamily: "var(--font-brand), serif" }}
                    >
                      {info.name}
                    </span>
                    <Badge
                      variant="secondary"
                      className="text-[10px]"
                      style={{ borderRadius: 0, fontFamily: "var(--font-code), monospace" }}
                    >
                      {count} model{count !== 1 ? "s" : ""}
                    </Badge>
                  </div>
                  <p
                    className="text-[11px] text-muted-foreground leading-relaxed"
                    style={{ fontFamily: "var(--font-body), serif" }}
                  >
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
            <div className="h-10 w-10 border border-foreground flex items-center justify-center">
              <ImageIcon className="h-5 w-5" />
            </div>
            <h2
              className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground"
              style={{ fontFamily: "var(--font-brand), serif" }}
            >
              Image Models
            </h2>
          </div>
          <p
            className="text-base text-muted-foreground mb-5 max-w-2xl leading-relaxed"
            style={{ fontFamily: "var(--font-body), serif" }}
          >
            {imageModelsCount} text-to-image models.
            Generate via{" "}
            <code
              className="text-foreground text-sm font-semibold"
              style={{ fontFamily: "var(--font-code), monospace" }}
            >
              POST /api/v1/image/generate
            </code>{" "}
            with{" "}
            <code
              className="text-foreground text-sm font-semibold"
              style={{ fontFamily: "var(--font-code), monospace" }}
            >
              &#123; prompt, model &#125;
            </code>.
          </p>
          <div className="flex flex-wrap items-center gap-2 mb-8">
            <Badge
              variant="outline"
              className="gap-1 border-foreground text-foreground"
              style={{ borderRadius: 0, fontFamily: "var(--font-code), monospace" }}
            >
              Anime: {imgCounts.anime}
            </Badge>
            <Badge
              variant="outline"
              className="gap-1 border-foreground text-foreground"
              style={{ borderRadius: 0, fontFamily: "var(--font-code), monospace" }}
            >
              Realism: {imgCounts.realism}
            </Badge>
            <Badge
              variant="outline"
              className="gap-1 border-foreground text-foreground"
              style={{ borderRadius: 0, fontFamily: "var(--font-code), monospace" }}
            >
              Mixed: {imgCounts.mixed}
            </Badge>
            <Badge
              variant="outline"
              className="gap-1 border-foreground text-foreground"
              style={{ borderRadius: 0, fontFamily: "var(--font-code), monospace" }}
            >
              General: {imgCounts.general}
            </Badge>
            <Button
              asChild
              size="sm"
              className="ml-auto gap-1.5 bg-foreground text-background uppercase tracking-widest text-sm hover:bg-background hover:text-foreground hover:border-2 hover:border-foreground transition-colors duration-100"
              style={{ borderRadius: 0 }}
            >
              <Link href="/docs#image-generation">
                <Terminal className="h-3.5 w-3.5" /> API docs
              </Link>
            </Button>
          </div>
          <ImageModelsShowcase />
        </div>

        {/* API quickstart */}
        <div className="mt-12 border border-foreground overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3 border-b border-foreground">
            <Terminal className="h-4 w-4 text-foreground" />
            <span
              className="text-xs text-muted-foreground font-medium"
              style={{ fontFamily: "var(--font-code), monospace" }}
            >
              quickstart
            </span>
          </div>
          <pre
            className="overflow-x-auto p-5 text-[13px] leading-relaxed text-foreground/80"
            style={{ fontFamily: "var(--font-code), monospace" }}
          >
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

      <footer className="mt-auto border-t border-foreground bg-background">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6 flex items-center justify-between">
          <span
            className="text-xs text-muted-foreground font-medium"
            style={{ fontFamily: "var(--font-code), monospace" }}
          >
            FreeAI4All · {textModels.length} chat + {imageModelsCount} image models · {providerList.length} providers
          </span>
          <Link
            href="/"
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors duration-100"
            style={{ fontFamily: "var(--font-code), monospace" }}
          >
            Home <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      </footer>
    </div>
  );
}

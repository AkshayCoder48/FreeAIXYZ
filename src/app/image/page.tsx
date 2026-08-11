"use client";

/**
 * Image Studio — Claymorphism-styled interactive image generation playground.
 */

import { useState, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import {
  ImageIcon,
  Loader2,
  Download,
  Copy,
  Check,
  Lock,
  Unlock,
  Terminal,
  ExternalLink,
  Sparkles,
  Square,
  Palette,
  Maximize2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Nav } from "@/components/nav";
import {
  IMAGE_MODELS,
  IMAGE_PROVIDER_INFO,
  imageModelCounts,
  type ImageCategory,
} from "@/lib/providers/image-registry";

const CATEGORY_LABELS: Record<ImageCategory, string> = {
  anime: "Anime",
  realism: "Realism",
  "unrestricted-anime": "Unrestricted Anime",
  "unrestricted-realism": "Unrestricted Realism",
  "unrestricted-mixed": "Unrestricted Mixed",
  mixed: "Mixed / Artistic",
  general: "General",
};

const CATEGORY_ORDER: ImageCategory[] = [
  "anime",
  "realism",
  "mixed",
  "general",
  "unrestricted-anime",
  "unrestricted-realism",
  "unrestricted-mixed",
];

const CATEGORY_COLORS: Record<ImageCategory, string> = {
  anime: "text-pink-500 border-pink-500/30 bg-pink-500/5",
  realism: "text-sky-500 border-sky-500/30 bg-sky-500/5",
  "unrestricted-anime": "text-rose-500 border-rose-500/30 bg-rose-500/5",
  "unrestricted-realism": "text-red-500 border-red-500/30 bg-red-500/5",
  "unrestricted-mixed": "text-fuchsia-500 border-fuchsia-500/30 bg-fuchsia-500/5",
  mixed: "text-purple-500 border-purple-500/30 bg-purple-500/5",
  general: "text-primary border-primary/30 bg-primary/5",
};

interface GeneratedImage {
  url: string;
  modelId: string;
  modelName: string;
  category: ImageCategory;
  provider: string;
  prompt: string;
  width: number;
  height: number;
  timestamp: number;
}

export default function ImageStudioPage() {
  const [prompt, setPrompt] = useState(
    "A cute anime girl with blue hair, masterpiece, best quality",
  );
  const [selectedModel, setSelectedModel] = useState<string>("poll-flux");
  const [width, setWidth] = useState(768);
  const [height, setHeight] = useState(768);
  const [matureUnlocked, setMatureUnlocked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<GeneratedImage[]>([]);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const counts = useMemo(() => imageModelCounts(), []);

  const visibleModels = useMemo(() => {
    if (matureUnlocked) return IMAGE_MODELS;
    return IMAGE_MODELS.filter(
      (m) =>
        m.category !== "unrestricted-anime" &&
        m.category !== "unrestricted-realism" &&
        m.category !== "unrestricted-mixed",
    );
  }, [matureUnlocked]);

  const groupedModels = useMemo(() => {
    const groups: Partial<Record<ImageCategory, typeof IMAGE_MODELS[number][]>> = {};
    for (const m of visibleModels) {
      if (!groups[m.category]) groups[m.category] = [];
      (groups[m.category] as typeof IMAGE_MODELS[number][]).push(m);
    }
    return groups;
  }, [visibleModels]);

  const selectedModelObj = useMemo(
    () => IMAGE_MODELS.find((m) => m.id === selectedModel),
    [selectedModel],
  );

  const onModelChange = useCallback((modelId: string) => {
    setSelectedModel(modelId);
  }, []);

  const generate = useCallback(async () => {
    if (!prompt.trim()) {
      toast.error("Please enter a prompt");
      return;
    }
    if (!selectedModelObj) {
      toast.error("Please select a model");
      return;
    }

    setLoading(true);
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const isMature =
      selectedModelObj.category === "unrestricted-anime" ||
      selectedModelObj.category === "unrestricted-realism" ||
      selectedModelObj.category === "unrestricted-mixed";

    const body: Record<string, unknown> = {
      prompt: prompt.trim(),
      model: selectedModel,
      width,
      height,
      nsfw: isMature ? true : undefined,
    };

    const startedAt = Date.now();
    try {
      const res = await fetch("/api/v1/image/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const img: GeneratedImage = {
        url: data.images[0].url,
        modelId: data.model,
        modelName: data.model_name,
        category: data.category,
        provider: data.provider,
        prompt: data.prompt ?? prompt.trim(),
        width: data.width ?? width,
        height: data.height ?? height,
        timestamp: Date.now(),
      };
      setHistory((h) => [img, ...h].slice(0, 24));
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      const fallbackMsg = data.fallback ? " (fallback from FreeGPT)" : "";
      toast.success(`${img.modelName} — generated in ${elapsed}s${fallbackMsg}`);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      toast.error((e as Error).message || "Generation failed");
    } finally {
      setLoading(false);
    }
  }, [prompt, selectedModel, selectedModelObj, width, height]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setLoading(false);
  }, []);

  const copyUrl = useCallback(async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      setTimeout(() => setCopiedUrl(null), 2000);
      toast.success("URL copied");
    } catch {
      toast.error("Copy failed");
    }
  }, []);

  const download = useCallback(async (img: GeneratedImage) => {
    try {
      const res = await fetch(img.url);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${img.modelId}-${img.timestamp}.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Downloaded");
    } catch {
      toast.error("Download failed");
    }
  }, []);

  return (
    <div className="relative min-h-screen flex flex-col bg-background overflow-hidden">
      {/* Background blobs */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute h-[50vh] w-[50vh] -top-[10%] -right-[10%] rounded-full bg-[#EC4899]/10 blur-3xl animate-clay-float" />
        <div className="absolute h-[45vh] w-[45vh] -left-[10%] bottom-[10%] rounded-full bg-[#8B5CF6]/10 blur-3xl animate-clay-float-delayed animation-delay-2000" />
        <div className="absolute h-[40vh] w-[40vh] top-[40%] right-[30%] rounded-full bg-[#0EA5E9]/10 blur-3xl animate-clay-float-slow animation-delay-4000" />
      </div>

      <Nav />

      <main className="flex-1 mx-auto max-w-7xl w-full px-4 sm:px-6 py-6">
        <div className="grid lg:grid-cols-[380px_1fr] gap-6">
          {/* Controls */}
          <div className="space-y-5">
            {/* Model selector */}
            <div className="rounded-[32px] bg-white/60 dark:bg-[#2D2440]/60 backdrop-blur-xl p-5 shadow-clay-card space-y-3 border border-primary/5">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-bold" style={{ fontFamily: "var(--font-brand), sans-serif" }}>Model</Label>
                <Badge variant="outline" className="text-[10px] rounded-[20px]">
                  {visibleModels.length} available
                </Badge>
              </div>
              <Select value={selectedModel} onValueChange={onModelChange}>
                <SelectTrigger className="w-full rounded-[20px] bg-[#EFEBF5] dark:bg-[#2D2440] shadow-clay-pressed border-0 h-12">
                  <SelectValue placeholder="Pick a model" />
                </SelectTrigger>
                <SelectContent className="max-h-80 rounded-[24px]">
                  {CATEGORY_ORDER.map((cat) => {
                    const models = groupedModels[cat];
                    if (!models || models.length === 0) return null;
                    return (
                      <SelectGroup key={cat}>
                        <SelectLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">
                          {CATEGORY_LABELS[cat]} ({models.length})
                        </SelectLabel>
                        {models.map((m) => (
                          <SelectItem key={m.id} value={m.id} className="text-sm rounded-[16px]">
                            {m.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    );
                  })}
                </SelectContent>
              </Select>
              {selectedModelObj && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge
                    variant="outline"
                    className={cn("text-[9px] rounded-[16px]", CATEGORY_COLORS[selectedModelObj.category])}
                  >
                    {CATEGORY_LABELS[selectedModelObj.category]}
                  </Badge>
                  <Badge variant="outline" className="text-[9px] text-muted-foreground rounded-[16px]">
                    {IMAGE_PROVIDER_INFO[selectedModelObj.provider].name}
                  </Badge>
                </div>
              )}
            </div>

            {/* Prompt */}
            <div className="rounded-[32px] bg-white/60 dark:bg-[#2D2440]/60 backdrop-blur-xl p-5 shadow-clay-card space-y-3 border border-primary/5">
              <Label className="text-sm font-bold" style={{ fontFamily: "var(--font-brand), sans-serif" }}>Prompt</Label>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe the image you want to generate…"
                className="min-h-[100px] resize-y rounded-[20px] bg-[#EFEBF5] dark:bg-[#2D2440] shadow-clay-pressed border-0 text-sm focus:bg-white dark:focus:bg-[#332B45] focus:ring-4 focus:ring-primary/20 transition-all duration-200 placeholder:text-muted-foreground"
              />
            </div>

            {/* Dimensions */}
            <div className="rounded-[32px] bg-white/60 dark:bg-[#2D2440]/60 backdrop-blur-xl p-5 shadow-clay-card space-y-3 border border-primary/5">
              <Label className="text-sm font-bold" style={{ fontFamily: "var(--font-brand), sans-serif" }}>Dimensions</Label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-[11px] text-muted-foreground uppercase tracking-wider">Width</Label>
                  <Input
                    type="number"
                    value={width}
                    onChange={(e) => setWidth(Number(e.target.value) || 768)}
                    min={64}
                    max={2048}
                    step={64}
                    className="h-11 rounded-[20px] bg-[#EFEBF5] dark:bg-[#2D2440] shadow-clay-pressed border-0 focus:bg-white dark:focus:bg-[#332B45] focus:ring-4 focus:ring-primary/20 transition-all duration-200"
                  />
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground uppercase tracking-wider">Height</Label>
                  <Input
                    type="number"
                    value={height}
                    onChange={(e) => setHeight(Number(e.target.value) || 768)}
                    min={64}
                    max={2048}
                    step={64}
                    className="h-11 rounded-[20px] bg-[#EFEBF5] dark:bg-[#2D2440] shadow-clay-pressed border-0 focus:bg-white dark:focus:bg-[#332B45] focus:ring-4 focus:ring-primary/20 transition-all duration-200"
                  />
                </div>
              </div>
            </div>

            {/* Mature models unlock */}
            <div className="rounded-[32px] bg-white/60 dark:bg-[#2D2440]/60 backdrop-blur-xl p-5 shadow-clay-card space-y-3 border border-primary/5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {matureUnlocked ? (
                    <Unlock className="h-4 w-4 text-rose-500" />
                  ) : (
                    <Lock className="h-4 w-4 text-muted-foreground" />
                  )}
                  <Label className="text-sm font-bold" style={{ fontFamily: "var(--font-brand), sans-serif" }}>Mature models</Label>
                </div>
                <Switch
                  checked={matureUnlocked}
                  onCheckedChange={setMatureUnlocked}
                />
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {matureUnlocked
                  ? "Unlocked — mature models are visible. You confirm you are 18+ and consent to adult content."
                  : `Locked — ${counts["unrestricted-anime"] + counts["unrestricted-realism"] + counts["unrestricted-mixed"]} mature models hidden. Toggle to reveal (18+).`}
              </p>
            </div>

            {/* Generate button */}
            <div className="flex gap-2">
              {loading ? (
                <button
                  onClick={cancel}
                  className="flex-1 h-14 rounded-[20px] bg-gradient-to-br from-red-400 to-red-600 text-white font-bold tracking-wide shadow-clay-button hover:-translate-y-1 hover:shadow-clay-button-hover active:scale-[0.92] active:shadow-clay-pressed transition-all duration-200 flex items-center justify-center gap-2"
                >
                  <Square className="h-4 w-4" /> Cancel
                </button>
              ) : (
                <button
                  onClick={generate}
                  disabled={!prompt.trim()}
                  className="flex-1 h-14 rounded-[20px] bg-gradient-to-br from-[#A78BFA] to-[#7C3AED] text-white font-bold tracking-wide shadow-clay-button hover:-translate-y-1 hover:shadow-clay-button-hover active:scale-[0.92] active:shadow-clay-pressed transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:hover:translate-y-0 disabled:active:scale-100"
                >
                  <ImageIcon className="h-4 w-4" /> Generate
                </button>
              )}
            </div>
          </div>

          {/* Output */}
          <div className="space-y-4">
            {loading && (
              <div className="rounded-[24px] bg-gradient-to-br from-purple-400/10 to-purple-600/5 p-5 flex items-center gap-3 shadow-clay-card border border-primary/10">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <div className="flex-1">
                  <p className="text-sm font-bold" style={{ fontFamily: "var(--font-brand), sans-serif" }}>
                    {selectedModelObj?.name} — generating…
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Creating your image, this may take a moment…
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={cancel} className="rounded-[20px]">
                  Cancel
                </Button>
              </div>
            )}

            {history.length === 0 && !loading ? (
              <div className="rounded-[32px] bg-white/30 dark:bg-[#2D2440]/30 backdrop-blur-xl p-16 text-center shadow-clay-card border border-dashed border-primary/15">
                <div className="h-16 w-16 rounded-[24px] bg-gradient-to-br from-purple-400 to-purple-600 flex items-center justify-center mx-auto shadow-clay-button animate-clay-breathe mb-4">
                  <Palette className="h-8 w-8 text-white" />
                </div>
                <p className="text-base font-semibold text-foreground" style={{ fontFamily: "var(--font-brand), sans-serif" }}>
                  Generated images will appear here
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  Pick a model, write a prompt, and hit Generate.
                </p>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-5">
                {history.map((img) => (
                  <div
                    key={img.timestamp + img.url}
                    className="rounded-[32px] bg-white/60 dark:bg-[#2D2440]/60 backdrop-blur-xl overflow-hidden shadow-clay-card hover:-translate-y-2 hover:shadow-clay-card-hover transition-all duration-500 group border border-primary/5"
                  >
                    <div className="relative aspect-square bg-muted/20 overflow-hidden">
                      <img
                        src={img.url}
                        alt={img.prompt}
                        className="w-full h-full object-contain"
                        loading="lazy"
                      />
                      <div className="absolute top-3 right-3 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => copyUrl(img.url)}
                          className="h-8 w-8 rounded-[16px] bg-white/80 dark:bg-[#2D2440]/80 backdrop-blur flex items-center justify-center shadow-clay-button hover:-translate-y-0.5 active:scale-[0.92] active:shadow-clay-pressed transition-all duration-200"
                          title="Copy URL"
                        >
                          {copiedUrl === img.url ? (
                            <Check className="h-3.5 w-3.5 text-emerald-500" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </button>
                        <button
                          onClick={() => download(img)}
                          className="h-8 w-8 rounded-[16px] bg-white/80 dark:bg-[#2D2440]/80 backdrop-blur flex items-center justify-center shadow-clay-button hover:-translate-y-0.5 active:scale-[0.92] active:shadow-clay-pressed transition-all duration-200"
                          title="Download"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </button>
                        <a
                          href={img.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="h-8 w-8 rounded-[16px] bg-white/80 dark:bg-[#2D2440]/80 backdrop-blur flex items-center justify-center shadow-clay-button hover:-translate-y-0.5 active:scale-[0.92] active:shadow-clay-pressed transition-all duration-200"
                          title="Open"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    </div>
                    <div className="p-4 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-bold truncate" style={{ fontFamily: "var(--font-brand), sans-serif" }}>
                          {img.modelName}
                        </span>
                        <Badge
                          variant="outline"
                          className={cn("text-[9px] shrink-0 rounded-[16px]", CATEGORY_COLORS[img.category])}
                        >
                          {CATEGORY_LABELS[img.category]}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                        {img.prompt}
                      </p>
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>
                          {img.width}×{img.height} · {img.provider}
                        </span>
                        <span>
                          {new Date(img.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      <footer className="mt-auto border-t border-primary/5 bg-white/40 dark:bg-[#1A1625]/40 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-4 flex items-center justify-between">
          <span className="text-xs text-muted-foreground font-medium">
            FreeAI4All Image Studio · {IMAGE_MODELS.length} models
          </span>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs rounded-[20px] hover:-translate-y-0.5 transition-all duration-200"
          >
            <Link href="/docs#image-generation">
              <Terminal className="h-3 w-3" /> API reference
            </Link>
          </Button>
        </div>
      </footer>
    </div>
  );
}

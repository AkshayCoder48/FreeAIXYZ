"use client";

/**
 * Image Studio — interactive image generation playground.
 *
 * Pick a model, type a prompt, set dimensions, unlock mature models, generate.
 * Uses the /api/v1/image/generate endpoint.
 */

import { useState, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ImageIcon,
  Loader2,
  Download,
  Copy,
  Check,
  ShieldAlert,
  Lock,
  Unlock,
  Terminal,
  ExternalLink,
  Sparkles,
  Square,
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
import {
  IMAGE_MODELS,
  IMAGE_PROVIDER_INFO,
  imageModelCounts,
  type ImageCategory,
} from "@/lib/providers/image-registry";

const CATEGORY_LABELS: Record<ImageCategory, string> = {
  anime: "Anime",
  realism: "Realism",
  "nsfw-anime": "Mature Anime",
  "nsfw-realism": "Mature Realism",
  "nsfw-mixed": "Mature Mixed",
  mixed: "Mixed / Artistic",
  general: "General",
};

const CATEGORY_ORDER: ImageCategory[] = [
  "anime",
  "realism",
  "mixed",
  "general",
  "nsfw-anime",
  "nsfw-realism",
  "nsfw-mixed",
];

const CATEGORY_COLORS: Record<ImageCategory, string> = {
  anime: "text-pink-500 border-pink-500/30 bg-pink-500/5",
  realism: "text-blue-500 border-blue-500/30 bg-blue-500/5",
  "nsfw-anime": "text-rose-500 border-rose-500/30 bg-rose-500/5",
  "nsfw-realism": "text-red-500 border-red-500/30 bg-red-500/5",
  "nsfw-mixed": "text-fuchsia-500 border-fuchsia-500/30 bg-fuchsia-500/5",
  mixed: "text-purple-500 border-purple-500/30 bg-purple-500/5",
  general: "text-amber-500 border-amber-500/30 bg-amber-500/5",
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
    "1girl, cute anime girl, blue hair, masterpiece, best quality",
  );
  const [selectedModel, setSelectedModel] = useState<string>("poll-flux");
  const [width, setWidth] = useState(768);
  const [height, setHeight] = useState(768);
  const [nsfwUnlocked, setNsfwUnlocked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<GeneratedImage[]>([]);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const counts = useMemo(() => imageModelCounts(), []);

  const visibleModels = useMemo(() => {
    if (nsfwUnlocked) return IMAGE_MODELS;
    return IMAGE_MODELS.filter(
      (m) =>
        m.category !== "nsfw-anime" &&
        m.category !== "nsfw-realism" &&
        m.category !== "nsfw-mixed",
    );
  }, [nsfwUnlocked]);

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
      selectedModelObj.category === "nsfw-anime" ||
      selectedModelObj.category === "nsfw-realism" ||
      selectedModelObj.category === "nsfw-mixed";

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
      toast.success(`${img.modelName} — generated in ${elapsed}s`);
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
        <div className="mx-auto max-w-7xl px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Button asChild variant="ghost" size="sm" className="gap-1.5">
              <Link href="/">
                <ArrowLeft className="h-4 w-4" /> Back
              </Link>
            </Button>
            <div className="h-5 w-px bg-border" />
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-[#ff9a3c]/10 border border-[#ff9a3c]/30 flex items-center justify-center">
                <ImageIcon className="h-4 w-4 text-[#ff9a3c]" />
              </div>
              <span className="text-sm font-semibold">Image Studio</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm" className="gap-1.5">
              <Link href="/models">
                <Sparkles className="h-3.5 w-3.5" /> All models
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="gap-1.5">
              <Link href="/docs#image-generation">
                <Terminal className="h-3.5 w-3.5" /> API docs
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto max-w-7xl w-full px-4 sm:px-6 py-6">
        <div className="grid lg:grid-cols-[380px_1fr] gap-6">
          {/* Controls */}
          <div className="space-y-5">
            {/* Model selector */}
            <div className="rounded-xl border border-border bg-card/40 backdrop-blur p-4 space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">Model</Label>
                <Badge variant="outline" className="text-[10px]">
                  {visibleModels.length} available
                </Badge>
              </div>
              <Select value={selectedModel} onValueChange={onModelChange}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Pick a model" />
                </SelectTrigger>
                <SelectContent className="max-h-80">
                  {CATEGORY_ORDER.map((cat) => {
                    const models = groupedModels[cat];
                    if (!models || models.length === 0) return null;
                    return (
                      <SelectGroup key={cat}>
                        <SelectLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">
                          {CATEGORY_LABELS[cat]} ({models.length})
                        </SelectLabel>
                        {models.map((m) => (
                          <SelectItem key={m.id} value={m.id} className="text-sm">
                            <span className="flex items-center gap-2">
                              {(m.category === "nsfw-anime" ||
                                m.category === "nsfw-realism" ||
                                m.category === "nsfw-mixed") && (
                                <ShieldAlert className="h-3 w-3 text-rose-500" />
                              )}
                              {m.name}
                            </span>
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
                    className={cn(
                      "text-[9px]",
                      CATEGORY_COLORS[selectedModelObj.category],
                    )}
                  >
                    {CATEGORY_LABELS[selectedModelObj.category]}
                  </Badge>
                  <Badge
                    variant="outline"
                    className="text-[9px] text-muted-foreground"
                  >
                    {IMAGE_PROVIDER_INFO[selectedModelObj.provider].name}
                  </Badge>
                  {(selectedModelObj.category === "nsfw-anime" ||
                    selectedModelObj.category === "nsfw-realism" ||
                    selectedModelObj.category === "nsfw-mixed") && (
                    <Badge
                      variant="outline"
                      className="text-[9px] text-rose-500 border-rose-500/30"
                    >
                      Mature
                    </Badge>
                  )}
                </div>
              )}
            </div>

            {/* Prompt */}
            <div className="rounded-xl border border-border bg-card/40 backdrop-blur p-4 space-y-3">
              <Label className="text-sm font-semibold">Prompt</Label>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe the image you want to generate…"
                className="min-h-[100px] resize-y bg-background/60 text-sm"
              />
            </div>

            {/* Dimensions */}
            <div className="rounded-xl border border-border bg-card/40 backdrop-blur p-4 space-y-3">
              <Label className="text-sm font-semibold">Dimensions</Label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-[11px] text-muted-foreground">
                    Width
                  </Label>
                  <Input
                    type="number"
                    value={width}
                    onChange={(e) =>
                      setWidth(Number(e.target.value) || 768)
                    }
                    min={64}
                    max={2048}
                    step={64}
                    className="h-9"
                  />
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground">
                    Height
                  </Label>
                  <Input
                    type="number"
                    value={height}
                    onChange={(e) =>
                      setHeight(Number(e.target.value) || 768)
                    }
                    min={64}
                    max={2048}
                    step={64}
                    className="h-9"
                  />
                </div>
              </div>
            </div>

            {/* NSFW unlock */}
            <div className="rounded-xl border border-border bg-card/40 backdrop-blur p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {nsfwUnlocked ? (
                    <Unlock className="h-4 w-4 text-rose-500" />
                  ) : (
                    <Lock className="h-4 w-4 text-muted-foreground" />
                  )}
                  <Label className="text-sm font-semibold">Mature models</Label>
                </div>
                <Switch
                  checked={nsfwUnlocked}
                  onCheckedChange={setNsfwUnlocked}
                />
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {nsfwUnlocked
                  ? "Unlocked — mature models are visible. You confirm you are 18+ and consent to adult content."
                  : `Locked — ${counts["nsfw-anime"] + counts["nsfw-realism"] + counts["nsfw-mixed"]} mature models hidden. Toggle to reveal (18+).`}
              </p>
            </div>

            {/* Generate button */}
            <div className="flex gap-2">
              {loading ? (
                <Button
                  variant="destructive"
                  className="flex-1 gap-2"
                  onClick={cancel}
                >
                  <Square className="h-4 w-4" /> Cancel
                </Button>
              ) : (
                <Button
                  className="flex-1 gap-2 bg-[#ff9a3c] hover:bg-[#ff9a3c]/90 text-white"
                  onClick={generate}
                  disabled={!prompt.trim()}
                >
                  <ImageIcon className="h-4 w-4" /> Generate
                </Button>
              )}
            </div>
          </div>

          {/* Output */}
          <div className="space-y-4">
            {loading && (
              <div className="rounded-xl border border-[#ff9a3c]/30 bg-[#ff9a3c]/5 p-4 flex items-center gap-3">
                <Loader2 className="h-5 w-5 animate-spin text-[#ff9a3c]" />
                <div className="flex-1">
                  <p className="text-sm font-medium">
                    {selectedModelObj?.name} — generating…
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Generating image…
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={cancel}>
                  Cancel
                </Button>
              </div>
            )}

            {history.length === 0 && !loading ? (
              <div className="rounded-xl border border-dashed border-border bg-card/20 p-12 text-center">
                <ImageIcon className="h-12 w-12 mx-auto text-muted-foreground/40 mb-3" />
                <p className="text-sm text-muted-foreground">
                  Generated images will appear here.
                </p>
                <p className="text-[11px] text-muted-foreground/70 mt-1">
                  Pick a model, write a prompt, and hit Generate.
                </p>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-4">
                {history.map((img) => (
                  <div
                    key={img.timestamp + img.url}
                    className="rounded-xl border border-border bg-card/40 backdrop-blur overflow-hidden group"
                  >
                    <div className="relative aspect-square bg-muted/20 overflow-hidden">
                      <img
                        src={img.url}
                        alt={img.prompt}
                        className="w-full h-full object-contain"
                        loading="lazy"
                      />
                      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          size="icon"
                          variant="secondary"
                          className="h-7 w-7"
                          onClick={() => copyUrl(img.url)}
                          title="Copy URL"
                        >
                          {copiedUrl === img.url ? (
                            <Check className="h-3 w-3" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </Button>
                        <Button
                          size="icon"
                          variant="secondary"
                          className="h-7 w-7"
                          onClick={() => download(img)}
                          title="Download"
                        >
                          <Download className="h-3 w-3" />
                        </Button>
                        <a
                          href={img.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center h-7 w-7 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80"
                          title="Open"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    </div>
                    <div className="p-3 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium truncate">
                          {img.modelName}
                        </span>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[9px] shrink-0",
                            CATEGORY_COLORS[img.category],
                          )}
                        >
                          {CATEGORY_LABELS[img.category]}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground line-clamp-2">
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

      <footer className="mt-auto border-t border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-4 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            FreeAIXYZ Image Studio · {IMAGE_MODELS.length} models
          </span>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="gap-1 text-xs"
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

"use client";

/**
 * Image Studio — Minimalist Monochrome design system.
 */

import { useState, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import {
  ImageIcon,
  Loader2,
  Download,
  Copy,
  Check,
  Terminal,
  ExternalLink,
  Square,
  Palette,
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
  mixed: "Mixed / Artistic",
  general: "General",
};

const CATEGORY_ORDER: ImageCategory[] = [
  "anime",
  "realism",
  "mixed",
  "general",
];

const CATEGORY_COLORS: Record<ImageCategory, string> = {
  anime: "text-foreground border-foreground/30",
  realism: "text-foreground/70 border-foreground/30",
  mixed: "text-foreground border-foreground",
  general: "text-foreground/70 border-foreground",
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
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<GeneratedImage[]>([]);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const counts = useMemo(() => imageModelCounts(), []);

  const visibleModels = useMemo(() => {
    return IMAGE_MODELS;
  }, []);

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

    const body: Record<string, unknown> = {
      prompt: prompt.trim(),
      model: selectedModel,
      width,
      height,
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
    <div className="relative min-h-screen flex flex-col bg-background">
      <Nav />

      <main className="flex-1 mx-auto max-w-7xl w-full px-4 sm:px-6 py-6">
        {/* Section divider */}
        <div className="h-[4px] bg-foreground mb-6" />

        <div className="grid lg:grid-cols-[380px_1fr] gap-6">
          {/* Controls */}
          <div className="space-y-5">
            {/* Model selector */}
            <div className="border border-foreground p-6 space-y-3">
              <div className="flex items-center justify-between">
                <Label
                  className="text-sm font-bold uppercase tracking-widest"
                  style={{ fontFamily: "var(--font-code), monospace" }}
                >
                  Model
                </Label>
                <Badge
                  variant="outline"
                  className="text-[10px] rounded-none border-foreground/30 text-foreground/70"
                  style={{ fontFamily: "var(--font-code), monospace" }}
                >
                  {visibleModels.length} available
                </Badge>
              </div>
              <Select value={selectedModel} onValueChange={onModelChange}>
                <SelectTrigger className="w-full rounded-none border-2 border-foreground bg-transparent focus:border-b-4 focus:outline-none h-12 transition-all duration-100">
                  <SelectValue placeholder="Pick a model" />
                </SelectTrigger>
                <SelectContent className="max-h-80 rounded-none">
                  {CATEGORY_ORDER.map((cat) => {
                    const models = groupedModels[cat];
                    if (!models || models.length === 0) return null;
                    return (
                      <SelectGroup key={cat}>
                        <SelectLabel
                          className="text-[11px] uppercase tracking-widest text-foreground/70"
                          style={{ fontFamily: "var(--font-code), monospace" }}
                        >
                          {CATEGORY_LABELS[cat]} ({models.length})
                        </SelectLabel>
                        {models.map((m) => (
                          <SelectItem
                            key={m.id}
                            value={m.id}
                            className="text-sm rounded-none"
                            style={{ fontFamily: "var(--font-body), serif" }}
                          >
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
                    className={cn("text-[9px] rounded-none", CATEGORY_COLORS[selectedModelObj.category])}
                    style={{ fontFamily: "var(--font-code), monospace" }}
                  >
                    {CATEGORY_LABELS[selectedModelObj.category]}
                  </Badge>
                  <Badge
                    variant="outline"
                    className="text-[9px] text-foreground/70 border-foreground/30 rounded-none"
                    style={{ fontFamily: "var(--font-code), monospace" }}
                  >
                    {IMAGE_PROVIDER_INFO[selectedModelObj.provider].name}
                  </Badge>
                </div>
              )}
            </div>

            {/* Prompt */}
            <div className="border border-foreground p-6 space-y-3">
              <Label
                className="text-sm font-bold uppercase tracking-widest"
                style={{ fontFamily: "var(--font-code), monospace" }}
              >
                Prompt
              </Label>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe the image you want to generate…"
                className="min-h-[100px] resize-y rounded-none border-2 border-foreground bg-transparent focus:border-b-4 focus:outline-none text-sm transition-all duration-100 placeholder:text-foreground/70"
                style={{ fontFamily: "var(--font-body), serif" }}
              />
            </div>

            {/* Dimensions */}
            <div className="border border-foreground p-6 space-y-3">
              <Label
                className="text-sm font-bold uppercase tracking-widest"
                style={{ fontFamily: "var(--font-code), monospace" }}
              >
                Dimensions
              </Label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label
                    className="text-[11px] text-foreground/70 uppercase tracking-widest"
                    style={{ fontFamily: "var(--font-code), monospace" }}
                  >
                    Width
                  </Label>
                  <Input
                    type="number"
                    value={width}
                    onChange={(e) => setWidth(Number(e.target.value) || 768)}
                    min={64}
                    max={2048}
                    step={64}
                    className="h-11 rounded-none border-2 border-foreground bg-transparent focus:border-b-4 focus:outline-none transition-all duration-100"
                    style={{ fontFamily: "var(--font-code), monospace" }}
                  />
                </div>
                <div>
                  <Label
                    className="text-[11px] text-foreground/70 uppercase tracking-widest"
                    style={{ fontFamily: "var(--font-code), monospace" }}
                  >
                    Height
                  </Label>
                  <Input
                    type="number"
                    value={height}
                    onChange={(e) => setHeight(Number(e.target.value) || 768)}
                    min={64}
                    max={2048}
                    step={64}
                    className="h-11 rounded-none border-2 border-foreground bg-transparent focus:border-b-4 focus:outline-none transition-all duration-100"
                    style={{ fontFamily: "var(--font-code), monospace" }}
                  />
                </div>
              </div>
            </div>

            {/* Generate / Cancel button */}
            <div className="flex gap-2">
              {loading ? (
                <button
                  onClick={cancel}
                  className="flex-1 h-14 bg-foreground text-background uppercase tracking-widest text-sm hover:bg-background hover:text-foreground hover:border-2 hover:border-foreground active:bg-foreground active:text-background transition-all duration-100 flex items-center justify-center gap-2"
                  style={{ fontFamily: "var(--font-code), monospace" }}
                >
                  <Square className="h-4 w-4" /> Cancel
                </button>
              ) : (
                <button
                  onClick={generate}
                  disabled={!prompt.trim()}
                  className="flex-1 h-14 bg-foreground text-background uppercase tracking-widest text-sm hover:bg-background hover:text-foreground hover:border-2 hover:border-foreground active:bg-foreground active:text-background transition-all duration-100 flex items-center justify-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed"
                  style={{ fontFamily: "var(--font-code), monospace" }}
                >
                  <ImageIcon className="h-4 w-4" /> Generate
                </button>
              )}
            </div>
          </div>

          {/* Output */}
          <div className="space-y-4">
            {loading && (
              <div className="border border-foreground p-5 flex items-center gap-3">
                <Loader2 className="h-6 w-6 animate-spin text-foreground" />
                <div className="flex-1">
                  <p
                    className="text-sm font-bold"
                    style={{ fontFamily: "var(--font-brand), serif" }}
                  >
                    {selectedModelObj?.name} — generating…
                  </p>
                  <p
                    className="text-xs text-foreground/70"
                    style={{ fontFamily: "var(--font-body), serif" }}
                  >
                    Creating your image, this may take a moment…
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={cancel}
                  className="rounded-none uppercase tracking-widest text-xs"
                  style={{ fontFamily: "var(--font-code), monospace" }}
                >
                  Cancel
                </Button>
              </div>
            )}

            {history.length === 0 && !loading ? (
              <div className="border border-foreground p-16 text-center">
                <div className="h-16 w-16 border-2 border-foreground flex items-center justify-center mx-auto mb-4">
                  <Palette className="h-8 w-8 text-foreground" />
                </div>
                <p
                  className="text-base font-semibold text-foreground"
                  style={{ fontFamily: "var(--font-brand), serif" }}
                >
                  Generated images will appear here
                </p>
                <p
                  className="text-sm text-foreground/70 mt-2"
                  style={{ fontFamily: "var(--font-body), serif" }}
                >
                  Pick a model, write a prompt, and hit Generate.
                </p>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-5">
                {history.map((img) => (
                  <div
                    key={img.timestamp + img.url}
                    className="border border-foreground overflow-hidden hover:bg-foreground hover:text-background transition-all duration-100 group"
                  >
                    <div className="relative aspect-square bg-muted overflow-hidden">
                      <img
                        src={img.url}
                        alt={img.prompt}
                        className="w-full h-full object-contain"
                        loading="lazy"
                      />
                      <div className="absolute top-3 right-3 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-100">
                        <button
                          onClick={() => copyUrl(img.url)}
                          className="h-8 w-8 bg-background border border-foreground flex items-center justify-center hover:bg-foreground hover:text-background transition-all duration-100"
                          title="Copy URL"
                        >
                          {copiedUrl === img.url ? (
                            <Check className="h-3.5 w-3.5" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </button>
                        <button
                          onClick={() => download(img)}
                          className="h-8 w-8 bg-background border border-foreground flex items-center justify-center hover:bg-foreground hover:text-background transition-all duration-100"
                          title="Download"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </button>
                        <a
                          href={img.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="h-8 w-8 bg-background border border-foreground flex items-center justify-center hover:bg-foreground hover:text-background transition-all duration-100"
                          title="Open"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    </div>
                    <div className="p-4 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className="text-sm font-bold truncate group-hover:text-background transition-colors duration-100"
                          style={{ fontFamily: "var(--font-brand), serif" }}
                        >
                          {img.modelName}
                        </span>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[9px] shrink-0 rounded-none group-hover:border-background group-hover:text-background",
                            CATEGORY_COLORS[img.category],
                          )}
                          style={{ fontFamily: "var(--font-code), monospace" }}
                        >
                          {CATEGORY_LABELS[img.category]}
                        </Badge>
                      </div>
                      <p
                        className="text-xs text-foreground/70 line-clamp-2 leading-relaxed group-hover:text-background/70 transition-colors duration-100"
                        style={{ fontFamily: "var(--font-body), serif" }}
                      >
                        {img.prompt}
                      </p>
                      <div
                        className="flex items-center justify-between text-[10px] text-foreground/70 group-hover:text-background/70 transition-colors duration-100"
                        style={{ fontFamily: "var(--font-code), monospace" }}
                      >
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

        {/* Section divider */}
        <div className="h-[4px] bg-foreground mt-8" />
      </main>

      <footer className="mt-auto border-t border-foreground">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-4 flex items-center justify-between">
          <span
            className="text-xs text-foreground/70 font-medium"
            style={{ fontFamily: "var(--font-code), monospace" }}
          >
            FreeAI4All Image Studio · {IMAGE_MODELS.length} models
          </span>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs rounded-none uppercase tracking-widest hover:bg-foreground hover:text-background transition-all duration-100"
            style={{ fontFamily: "var(--font-code), monospace" }}
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

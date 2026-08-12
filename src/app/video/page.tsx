"use client";

/**
 * Video Studio — AI Video Generation via NSFW Gateway (BYOK).
 */

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import {
  VideoIcon,
  Loader2,
  Download,
  Copy,
  Check,
  Key,
  Eye,
  EyeOff,
  Terminal,
  ExternalLink,
  Square,
  ImageIcon,
  Upload,
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
import { Nav } from "@/components/nav";
import {
  VIDEO_MODELS,
  VIDEO_PROVIDER_INFO,
  videoModelCounts,
  type VideoCategory,
} from "@/lib/providers/video-registry";

const CATEGORY_LABELS: Record<VideoCategory, string> = {
  general: "General",
  animation: "Animation",
  anime: "Anime",
  "face-swap": "Face Swap",
  unrestricted: "Unrestricted",
};

const CATEGORY_ORDER: VideoCategory[] = ["general", "animation", "anime", "face-swap", "unrestricted"];

const CATEGORY_COLORS: Record<VideoCategory, string> = {
  general: "text-primary border-primary/30 bg-primary/5",
  animation: "text-sky-500 border-sky-500/30 bg-sky-500/5",
  anime: "text-pink-500 border-pink-500/30 bg-pink-500/5",
  "face-swap": "text-amber-500 border-amber-500/30 bg-amber-500/5",
  unrestricted: "text-rose-500 border-rose-500/30 bg-rose-500/5",
};

interface GeneratedVideo {
  url: string;
  coverUrl?: string;
  modelId: string;
  modelName: string;
  category: VideoCategory;
  provider: string;
  prompt: string;
  duration: number;
  timestamp: number;
}

export default function VideoStudioPage() {
  const [prompt, setPrompt] = useState("A beautiful woman dancing in neon lights, cinematic");
  const [selectedModel, setSelectedModel] = useState<string>("nsgw-text2video");
  const [duration, setDuration] = useState(5);
  const [resourceId, setResourceId] = useState("");
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<GeneratedVideo[]>([]);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // BYOK state — NSFW Gateway
  const [byokToken, setByokToken] = useState("");
  const [byokDeviceId, setByokDeviceId] = useState("");
  const [showToken, setShowToken] = useState(false);

  // BYOK state — Dreemy
  const [dreemyToken, setDreemyToken] = useState("");
  const [showDreemyToken, setShowDreemyToken] = useState(false);

  useEffect(() => {
    const savedToken = sessionStorage.getItem("nsgw_token");
    const savedDeviceId = sessionStorage.getItem("nsgw_device_id");
    if (savedToken) setByokToken(savedToken);
    if (savedDeviceId) setByokDeviceId(savedDeviceId);
    const savedDreemyToken = sessionStorage.getItem("dreemy_token");
    if (savedDreemyToken) setDreemyToken(savedDreemyToken);
  }, []);

  useEffect(() => {
    if (byokToken) sessionStorage.setItem("nsgw_token", byokToken);
    else sessionStorage.removeItem("nsgw_token");
  }, [byokToken]);
  useEffect(() => {
    if (byokDeviceId) sessionStorage.setItem("nsgw_device_id", byokDeviceId);
    else sessionStorage.removeItem("nsgw_device_id");
  }, [byokDeviceId]);
  useEffect(() => {
    if (dreemyToken) sessionStorage.setItem("dreemy_token", dreemyToken);
    else sessionStorage.removeItem("dreemy_token");
  }, [dreemyToken]);

  const hasByokCredentials = byokToken.trim() && byokDeviceId.trim();
  const hasDreemyCredentials = dreemyToken.trim(); // Dreemy guests have 0 credits — BYOK required

  const counts = useMemo(() => videoModelCounts(), []);

  const groupedModels = useMemo(() => {
    const groups: Partial<Record<VideoCategory, typeof VIDEO_MODELS[number][]>> = {};
    for (const m of VIDEO_MODELS) {
      if (!groups[m.category]) groups[m.category] = [];
      (groups[m.category] as typeof VIDEO_MODELS[number][]).push(m);
    }
    return groups;
  }, []);

  const selectedModelObj = useMemo(
    () => VIDEO_MODELS.find((m) => m.id === selectedModel),
    [selectedModel],
  );

  const isDreemyModel = selectedModelObj?.provider === "dreemy";
  const hasRequiredCredentials = isDreemyModel ? hasDreemyCredentials : hasByokCredentials;

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
    if (!hasRequiredCredentials) {
      toast.error(isDreemyModel
        ? "Dreemy requires your x-auth-token (guests have 0 credits). Enter your dreemy.ai token below."
        : "NSFW Gateway requires your JWT token and Device ID. Enter them below.");
      return;
    }
    if (selectedModelObj.needsImage && !resourceId.trim()) {
      toast.error("This model requires a source image resourceId.");
      return;
    }

    setLoading(true);
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const body: Record<string, unknown> = {
      prompt: prompt.trim(),
      model: selectedModel,
      duration,
      nsfw: true, // consent for unrestricted models
    };
    if (isDreemyModel) {
      if (dreemyToken.trim()) body.dreemy_token = dreemyToken.trim();
    } else {
      body.byok_token = byokToken.trim();
      body.byok_device_id = byokDeviceId.trim();
    }
    if (resourceId.trim()) body.resourceId = resourceId.trim();

    const startedAt = Date.now();
    try {
      const res = await fetch("/api/v1/video/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const videoUrl = data.videos?.[0]?.url;
      const coverUrl = data.videos?.[0]?.cover_url;
      if (!videoUrl || videoUrl.startsWith("nsgw://") || videoUrl.startsWith("dreemy://")) {
        // Still processing — show polling info
        toast.info(`Video is generating (task: ${data.task_id}). Poll for results.`, { duration: 8000 });
        return;
      }
      const vid: GeneratedVideo = {
        url: videoUrl,
        coverUrl,
        modelId: data.model,
        modelName: data.model_name,
        category: data.category,
        provider: data.provider,
        prompt: data.prompt ?? prompt.trim(),
        duration: data.duration ?? duration,
        timestamp: Date.now(),
      };
      setHistory((h) => [vid, ...h].slice(0, 24));
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      toast.success(`${vid.modelName} — generated in ${elapsed}s`);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      toast.error((e as Error).message || "Generation failed");
    } finally {
      setLoading(false);
    }
  }, [prompt, selectedModel, selectedModelObj, duration, resourceId, byokToken, byokDeviceId, dreemyToken, hasRequiredCredentials, isDreemyModel]);

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

  return (
    <div className="relative min-h-screen flex flex-col bg-background overflow-hidden">
      {/* Background blobs */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute h-[50vh] w-[50vh] -top-[10%] -right-[10%] rounded-full bg-[#F59E0B]/10 blur-3xl animate-clay-float" />
        <div className="absolute h-[45vh] w-[45vh] -left-[10%] bottom-[10%] rounded-full bg-[#EC4899]/10 blur-3xl animate-clay-float-delayed animation-delay-2000" />
        <div className="absolute h-[40vh] w-[40vh] top-[40%] right-[30%] rounded-full bg-[#8B5CF6]/10 blur-3xl animate-clay-float-slow animation-delay-4000" />
      </div>

      <Nav />

      <main className="flex-1 mx-auto max-w-7xl w-full px-4 sm:px-6 py-6">
        <div className="grid lg:grid-cols-[380px_1fr] gap-6">
          {/* Controls */}
          <div className="space-y-5">
            {/* BYOK Credentials — NSFW Gateway */}
            <div className="rounded-[32px] bg-white/60 dark:bg-[#2D2440]/60 backdrop-blur-xl p-5 shadow-clay-card space-y-3 border border-amber-500/20">
              <div className="flex items-center gap-2">
                <Key className="h-4 w-4 text-amber-500" />
                <Label className="text-sm font-bold" style={{ fontFamily: "var(--font-brand), sans-serif" }}>NSFW Gateway — BYOK</Label>
                {hasByokCredentials && (
                  <Badge variant="outline" className="text-[9px] text-emerald-500 border-emerald-500/30 bg-emerald-500/5 rounded-[16px]">connected</Badge>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Bring Your Own Key from nsfwimg2video.com. Token stays in sessionStorage.
              </p>
              <div className="space-y-2">
                <div>
                  <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">JWT Token</Label>
                  <div className="relative">
                    <Input
                      type={showToken ? "text" : "password"}
                      value={byokToken}
                      onChange={(e) => setByokToken(e.target.value)}
                      placeholder="Paste your access_token JWT here…"
                      className="h-10 pr-10 rounded-[20px] bg-[#EFEBF5] dark:bg-[#2D2440] shadow-clay-pressed border-0 text-xs font-mono focus:bg-white dark:focus:bg-[#332B45] focus:ring-4 focus:ring-amber-500/20 transition-all duration-200"
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken(!showToken)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Device ID</Label>
                  <Input
                    type="text"
                    value={byokDeviceId}
                    onChange={(e) => setByokDeviceId(e.target.value)}
                    placeholder="Your user/device ID from nsfwimg2video.com"
                    className="h-10 rounded-[20px] bg-[#EFEBF5] dark:bg-[#2D2440] shadow-clay-pressed border-0 text-xs font-mono focus:bg-white dark:focus:bg-[#332B45] focus:ring-4 focus:ring-amber-500/20 transition-all duration-200"
                  />
                </div>
                <details className="text-[10px] text-muted-foreground">
                  <summary className="cursor-pointer hover:text-foreground transition-colors">How to get your token</summary>
                  <ol className="mt-1.5 ml-3 list-decimal space-y-0.5 leading-relaxed">
                    <li>Open <a href="https://www.nsfwimg2video.com" target="_blank" rel="noopener noreferrer" className="text-primary underline">nsfwimg2video.com</a> and sign in</li>
                    <li>Open DevTools Console (F12)</li>
                    <li>Run: <code className="bg-muted px-1 rounded text-[9px]">copy(document.cookie.match(/access_token=([^;]+)/)?.[1])</code></li>
                    <li>Paste the token above. Your Device ID is your username from the JWT.</li>
                  </ol>
                </details>
              </div>
            </div>

            {/* BYOK Credentials — Dreemy */}
            <div className="rounded-[32px] bg-white/60 dark:bg-[#2D2440]/60 backdrop-blur-xl p-5 shadow-clay-card space-y-3 border border-rose-500/20">
              <div className="flex items-center gap-2">
                <Key className="h-4 w-4 text-rose-500" />
                <Label className="text-sm font-bold" style={{ fontFamily: "var(--font-brand), sans-serif" }}>Dreemy.ai — BYOK</Label>
                {hasDreemyCredentials && (
                  <Badge variant="outline" className="text-[9px] text-emerald-500 border-emerald-500/30 bg-emerald-500/5 rounded-[16px]">connected</Badge>
                )}
                {!hasDreemyCredentials && (
                  <Badge variant="outline" className="text-[9px] text-red-500 border-red-500/30 bg-red-500/5 rounded-[16px]">no token</Badge>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                <strong className="text-red-500">Required.</strong> Dreemy guests have 0 credits — you must provide your own x-auth-token from a registered dreemy.ai account with credits.
              </p>
              <div className="space-y-2">
                <div>
                  <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">x-auth-token</Label>
                  <div className="relative">
                    <Input
                      type={showDreemyToken ? "text" : "password"}
                      value={dreemyToken}
                      onChange={(e) => setDreemyToken(e.target.value)}
                      placeholder="Paste your dreemy.ai x-auth-token…"
                      className="h-10 pr-10 rounded-[20px] bg-[#EFEBF5] dark:bg-[#2D2440] shadow-clay-pressed border-0 text-xs font-mono focus:bg-white dark:focus:bg-[#332B45] focus:ring-4 focus:ring-rose-500/20 transition-all duration-200"
                    />
                    <button
                      type="button"
                      onClick={() => setShowDreemyToken(!showDreemyToken)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showDreemyToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
                <details className="text-[10px] text-muted-foreground">
                  <summary className="cursor-pointer hover:text-foreground transition-colors">How to get your token</summary>
                  <ol className="mt-1.5 ml-3 list-decimal space-y-0.5 leading-relaxed">
                    <li>Open <a href="https://www.dreemy.ai" target="_blank" rel="noopener noreferrer" className="text-primary underline">dreemy.ai</a> and sign in</li>
                    <li>Open DevTools Console (F12)</li>
                    <li>Run: <code className="bg-muted px-1 rounded text-[9px]">copy(localStorage.getItem("x-auth-token"))</code></li>
                    <li>Paste the token above.</li>
                  </ol>
                </details>
              </div>
            </div>

            {/* Model selector */}
            <div className="rounded-[32px] bg-white/60 dark:bg-[#2D2440]/60 backdrop-blur-xl p-5 shadow-clay-card space-y-3 border border-primary/5">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-bold" style={{ fontFamily: "var(--font-brand), sans-serif" }}>Model</Label>
                <Badge variant="outline" className="text-[10px] rounded-[20px]">
                  {VIDEO_MODELS.length} models
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
                    {VIDEO_PROVIDER_INFO[selectedModelObj.provider].name}
                  </Badge>
                  {selectedModelObj.needsImage && (
                    <Badge variant="outline" className="text-[9px] text-amber-500 border-amber-500/30 bg-amber-500/5 rounded-[16px]">
                      needs image
                    </Badge>
                  )}
                </div>
              )}
            </div>

            {/* Prompt */}
            <div className="rounded-[32px] bg-white/60 dark:bg-[#2D2440]/60 backdrop-blur-xl p-5 shadow-clay-card space-y-3 border border-primary/5">
              <Label className="text-sm font-bold" style={{ fontFamily: "var(--font-brand), sans-serif" }}>Prompt</Label>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe the video you want to generate…"
                className="min-h-[100px] resize-y rounded-[20px] bg-[#EFEBF5] dark:bg-[#2D2440] shadow-clay-pressed border-0 text-sm focus:bg-white dark:focus:bg-[#332B45] focus:ring-4 focus:ring-primary/20 transition-all duration-200 placeholder:text-muted-foreground"
              />
            </div>

            {/* Duration + Resource ID */}
            <div className="rounded-[32px] bg-white/60 dark:bg-[#2D2440]/60 backdrop-blur-xl p-5 shadow-clay-card space-y-3 border border-primary/5">
              <Label className="text-sm font-bold" style={{ fontFamily: "var(--font-brand), sans-serif" }}>Settings</Label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-[11px] text-muted-foreground uppercase tracking-wider">Duration (sec)</Label>
                  <Input
                    type="number"
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value) || 5)}
                    min={1}
                    max={30}
                    step={1}
                    className="h-11 rounded-[20px] bg-[#EFEBF5] dark:bg-[#2D2440] shadow-clay-pressed border-0 focus:bg-white dark:focus:bg-[#332B45] focus:ring-4 focus:ring-primary/20 transition-all duration-200"
                  />
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground uppercase tracking-wider">Resource ID</Label>
                  <Input
                    type="text"
                    value={resourceId}
                    onChange={(e) => setResourceId(e.target.value)}
                    placeholder={selectedModelObj?.needsImage ? "Required" : "Optional"}
                    className="h-11 rounded-[20px] bg-[#EFEBF5] dark:bg-[#2D2440] shadow-clay-pressed border-0 text-xs font-mono focus:bg-white dark:focus:bg-[#332B45] focus:ring-4 focus:ring-primary/20 transition-all duration-200"
                  />
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">
                {selectedModelObj?.needsImage
                  ? "This model requires a source image resourceId from a previous upload."
                  : "This model generates from text only — no source image needed."}
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
                  disabled={!prompt.trim() || (!isDreemyModel && !hasByokCredentials) || (selectedModelObj?.needsImage && !resourceId.trim())}
                  className="flex-1 h-14 rounded-[20px] bg-gradient-to-br from-amber-400 to-amber-600 text-white font-bold tracking-wide shadow-clay-button hover:-translate-y-1 hover:shadow-clay-button-hover active:scale-[0.92] active:shadow-clay-pressed transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:hover:translate-y-0 disabled:active:scale-100"
                >
                  <VideoIcon className="h-4 w-4" /> Generate Video
                </button>
              )}
            </div>
          </div>

          {/* Output */}
          <div className="space-y-4">
            {loading && (
              <div className="rounded-[24px] bg-gradient-to-br from-amber-400/10 to-amber-600/5 p-5 flex items-center gap-3 shadow-clay-card border border-primary/10">
                <Loader2 className="h-6 w-6 animate-spin text-amber-500" />
                <div className="flex-1">
                  <p className="text-sm font-bold" style={{ fontFamily: "var(--font-brand), sans-serif" }}>
                    {selectedModelObj?.name} — generating video…
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Video generation typically takes 60-90 seconds. Please wait…
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={cancel} className="rounded-[20px]">
                  Cancel
                </Button>
              </div>
            )}

            {history.length === 0 && !loading ? (
              <div className="rounded-[32px] bg-white/30 dark:bg-[#2D2440]/30 backdrop-blur-xl p-16 text-center shadow-clay-card border border-dashed border-primary/15">
                <div className="h-16 w-16 rounded-[24px] bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center mx-auto shadow-clay-button animate-clay-breathe mb-4">
                  <VideoIcon className="h-8 w-8 text-white" />
                </div>
                <p className="text-base font-semibold text-foreground" style={{ fontFamily: "var(--font-brand), sans-serif" }}>
                  Generated videos will appear here
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  Enter your BYOK credentials, pick a model, write a prompt, and hit Generate Video.
                </p>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-5">
                {history.map((vid) => (
                  <div
                    key={vid.timestamp + vid.url}
                    className="rounded-[32px] bg-white/60 dark:bg-[#2D2440]/60 backdrop-blur-xl overflow-hidden shadow-clay-card hover:-translate-y-2 hover:shadow-clay-card-hover transition-all duration-500 group border border-primary/5"
                  >
                    <div className="relative aspect-video bg-muted/20 overflow-hidden">
                      {vid.url.endsWith(".mp4") ? (
                        <video
                          src={vid.url}
                          controls
                          className="w-full h-full object-contain"
                          poster={vid.coverUrl}
                        />
                      ) : (
                        <img
                          src={vid.coverUrl || vid.url}
                          alt={vid.prompt}
                          className="w-full h-full object-contain"
                          loading="lazy"
                        />
                      )}
                      <div className="absolute top-3 right-3 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => copyUrl(vid.url)}
                          className="h-8 w-8 rounded-[16px] bg-white/80 dark:bg-[#2D2440]/80 backdrop-blur flex items-center justify-center shadow-clay-button hover:-translate-y-0.5 active:scale-[0.92] active:shadow-clay-pressed transition-all duration-200"
                          title="Copy URL"
                        >
                          {copiedUrl === vid.url ? (
                            <Check className="h-3.5 w-3.5 text-emerald-500" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </button>
                        <a
                          href={vid.url}
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
                          {vid.modelName}
                        </span>
                        <Badge
                          variant="outline"
                          className={cn("text-[9px] shrink-0 rounded-[16px]", CATEGORY_COLORS[vid.category])}
                        >
                          {CATEGORY_LABELS[vid.category]}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                        {vid.prompt}
                      </p>
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>
                          {vid.duration}s · {vid.provider}
                        </span>
                        <span>
                          {new Date(vid.timestamp).toLocaleTimeString()}
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
            FreeAI4All Video Studio · {VIDEO_MODELS.length} models · BYOK
          </span>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs rounded-[20px] hover:-translate-y-0.5 transition-all duration-200"
          >
            <Link href="/docs">
              <Terminal className="h-3 w-3" /> API reference
            </Link>
          </Button>
        </div>
      </footer>
    </div>
  );
}

// Utility — same cn from utils
function cn(...inputs: (string | undefined | false | null)[]) {
  return inputs.filter(Boolean).join(" ");
}

"use client";

/**
 * API Tools — Interactive playgrounds for utility APIs.
 * Tabs: Text-to-Speech, Web Search, Image Tools
 */

import { useState, useRef, useCallback } from "react";
import Link from "next/link";
import {
  Volume2,
  Search,
  ImageIcon,
  Loader2,
  Terminal,
  ExternalLink,
  Eraser,
  Maximize,
  Palette,
  Wand2,
  Wrench,
  Square,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { toast } from "sonner";
import { Nav } from "@/components/nav";

/* ────────────────────────────────────────────
   Shared styles
   ──────────────────────────────────────────── */
const BRAND = { fontFamily: "var(--font-brand), serif" } as React.CSSProperties;
const BODY = { fontFamily: "var(--font-body), serif" } as React.CSSProperties;
const CODE = { fontFamily: "var(--font-code), monospace" } as React.CSSProperties;

const cardCls = "border border-foreground p-6";
const inputCls =
  "w-full rounded-none border-2 border-foreground bg-transparent focus:border-b-4 focus:outline-none transition-all duration-100";
const btnCls =
  "h-12 bg-foreground text-background uppercase tracking-widest text-sm hover:bg-background hover:text-foreground hover:border-2 hover:border-foreground active:bg-foreground active:text-background transition-all duration-100 flex items-center justify-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed";

/* ────────────────────────────────────────────
   Image manipulation actions config
   ──────────────────────────────────────────── */
const IMAGE_ACTIONS = [
  { id: "removebg", label: "Remove Background", icon: Eraser },
  { id: "enlarger", label: "Upscale Image", icon: Maximize },
  { id: "unblur", label: "Deblur Image", icon: Maximize },
  { id: "colorize", label: "Colorize B&W", icon: Palette },
  { id: "unwatermark", label: "Remove Watermark", icon: Eraser },
  { id: "nanobanana2", label: "AI Edit", icon: Wand2 },
  { id: "faceswap", label: "Face Swap", icon: Wand2 },
  { id: "iloveimg", label: "Compress/Resize", icon: ImageIcon },
] as const;

type ImageActionId = (typeof IMAGE_ACTIONS)[number]["id"];

/* ────────────────────────────────────────────
   Main page
   ──────────────────────────────────────────── */
export default function ToolsPage() {
  return (
    <div className="relative min-h-screen flex flex-col bg-background">
      <Nav />

      <main className="flex-1 mx-auto max-w-5xl w-full px-4 sm:px-6 py-10">
        {/* Heading */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-10 w-10 border border-foreground flex items-center justify-center">
              <Wrench className="h-5 w-5" />
            </div>
            <h1
              className="text-2xl sm:text-3xl md:text-4xl font-extrabold tracking-tight text-foreground"
              style={BRAND}
            >
              API Tools
            </h1>
          </div>
          <p
            className="text-base text-muted-foreground max-w-2xl leading-relaxed"
            style={BODY}
          >
            Interactive playgrounds for utility APIs — test TTS, search, and image
            manipulation live.
          </p>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="tts" className="w-full">
          <TabsList className="w-full mb-6 bg-transparent border-b border-foreground rounded-none h-auto p-0 gap-0 flex">
            <TabsTrigger
              value="tts"
              className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3 text-xs font-medium uppercase tracking-widest transition-colors duration-100 data-[state=active]:text-foreground text-muted-foreground"
              style={CODE}
            >
              <Volume2 className="h-3.5 w-3.5 mr-1.5" />
              Text-to-Speech
            </TabsTrigger>
            <TabsTrigger
              value="search"
              className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3 text-xs font-medium uppercase tracking-widest transition-colors duration-100 data-[state=active]:text-foreground text-muted-foreground"
              style={CODE}
            >
              <Search className="h-3.5 w-3.5 mr-1.5" />
              Web Search
            </TabsTrigger>
            <TabsTrigger
              value="image"
              className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3 text-xs font-medium uppercase tracking-widest transition-colors duration-100 data-[state=active]:text-foreground text-muted-foreground"
              style={CODE}
            >
              <ImageIcon className="h-3.5 w-3.5 mr-1.5" />
              Image Tools
            </TabsTrigger>
          </TabsList>

          <TabsContent value="tts" className="mt-0">
            <TTSPlayground />
          </TabsContent>
          <TabsContent value="search" className="mt-0">
            <SearchPlayground />
          </TabsContent>
          <TabsContent value="image" className="mt-0">
            <ImageToolsPlayground />
          </TabsContent>
        </Tabs>
      </main>

      <footer className="mt-auto border-t border-foreground">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 py-4 flex items-center justify-between">
          <span className="text-xs text-foreground/70 font-medium" style={CODE}>
            FreeAI4All · API Tools
          </span>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs rounded-none uppercase tracking-widest hover:bg-foreground hover:text-background transition-all duration-100"
            style={CODE}
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

/* ════════════════════════════════════════════
   TTS Playground
   ════════════════════════════════════════════ */
function TTSPlayground() {
  const [text, setText] = useState("");
  const [voice, setVoice] = useState("af_bella");
  const [language, setLanguage] = useState("en-us");
  const [speed, setSpeed] = useState(1.0);
  const [loading, setLoading] = useState(false);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const generate = useCallback(async () => {
    if (!text.trim()) {
      toast.error("Please enter text");
      return;
    }
    setLoading(true);
    setError(null);
    setAudioSrc(null);
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch("/api/v1/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim(), voice, language, speed }),
        signal: ctrl.signal,
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const b64 = data.audio_base64;
      const fmt = data.format || "wav";
      const src = `data:audio/${fmt};base64,${b64}`;
      setAudioSrc(src);
      toast.success("Speech generated successfully");
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      const msg = (e as Error).message || "TTS failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [text, voice, language, speed]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setLoading(false);
  }, []);

  return (
    <div className="space-y-5">
      {/* Text input */}
      <div className={cardCls}>
        <Label
          className="text-sm font-bold uppercase tracking-widest mb-3 block"
          style={CODE}
        >
          Text
        </Label>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Enter text to convert to speech..."
          className={`min-h-[100px] resize-y ${inputCls} text-sm placeholder:text-foreground/70`}
          style={BODY}
        />
      </div>

      {/* Voice & Language */}
      <div className="grid sm:grid-cols-2 gap-5">
        <div className={cardCls}>
          <Label
            className="text-sm font-bold uppercase tracking-widest mb-3 block"
            style={CODE}
          >
            Voice
          </Label>
          <Select value={voice} onValueChange={setVoice}>
            <SelectTrigger className={`h-11 ${inputCls}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-none">
              <SelectItem value="af_bella" className="rounded-none" style={BODY}>af_bella</SelectItem>
              <SelectItem value="af_nicole" className="rounded-none" style={BODY}>af_nicole</SelectItem>
              <SelectItem value="af_sarah" className="rounded-none" style={BODY}>af_sarah</SelectItem>
              <SelectItem value="am_adam" className="rounded-none" style={BODY}>am_adam</SelectItem>
              <SelectItem value="am_michael" className="rounded-none" style={BODY}>am_michael</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className={cardCls}>
          <Label
            className="text-sm font-bold uppercase tracking-widest mb-3 block"
            style={CODE}
          >
            Language
          </Label>
          <Select value={language} onValueChange={setLanguage}>
            <SelectTrigger className={`h-11 ${inputCls}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-none">
              {["en-us", "es", "fr", "de", "it", "pt", "ja", "ko", "zh"].map((l) => (
                <SelectItem key={l} value={l} className="rounded-none" style={BODY}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Speed */}
      <div className={cardCls}>
        <Label
          className="text-sm font-bold uppercase tracking-widest mb-3 block"
          style={CODE}
        >
          Speed
        </Label>
        <div className="flex items-center gap-4">
          <input
            type="range"
            min={0.5}
            max={2.0}
            step={0.1}
            value={speed}
            onChange={(e) => setSpeed(parseFloat(e.target.value))}
            className="flex-1 accent-foreground"
          />
          <span
            className="text-sm font-bold text-foreground min-w-[3rem] text-right"
            style={CODE}
          >
            {speed.toFixed(1)}x
          </span>
        </div>
      </div>

      {/* Button */}
      <div className="flex gap-2">
        {loading ? (
          <button onClick={cancel} className={`flex-1 ${btnCls}`} style={CODE}>
            <Square className="h-4 w-4" /> Cancel
          </button>
        ) : (
          <button
            onClick={generate}
            disabled={!text.trim()}
            className={`flex-1 ${btnCls}`}
            style={CODE}
          >
            <Volume2 className="h-4 w-4" /> Generate Speech
          </button>
        )}
      </div>

      {/* Loading state */}
      {loading && (
        <div className="border border-foreground p-5 flex items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-foreground" />
          <div className="flex-1">
            <p className="text-sm font-bold" style={BRAND}>
              Generating speech…
            </p>
            <p className="text-xs text-foreground/70" style={BODY}>
              Converting text to audio, this may take a moment…
            </p>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="border border-foreground p-5 border-red-500/50">
          <p className="text-sm font-bold text-red-500" style={BRAND}>Error</p>
          <p className="text-xs text-red-400 mt-1" style={BODY}>{error}</p>
        </div>
      )}

      {/* Audio result */}
      {audioSrc && (
        <div className={cardCls}>
          <Label
            className="text-sm font-bold uppercase tracking-widest mb-3 block"
            style={CODE}
          >
            Result
          </Label>
          <audio ref={audioRef} controls src={audioSrc} className="w-full" />
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════
   Web Search Playground
   ════════════════════════════════════════════ */
interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

function SearchPlayground() {
  const [query, setQuery] = useState("");
  const [engine, setEngine] = useState("miklium");
  const [num, setNum] = useState("8");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [usedEngine, setUsedEngine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const doSearch = useCallback(async () => {
    if (!query.trim()) {
      toast.error("Please enter a search query");
      return;
    }
    setLoading(true);
    setError(null);
    setResults([]);
    setUsedEngine(null);
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch("/api/v1/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim(), num: parseInt(num), engine }),
        signal: ctrl.signal,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setResults(data.results || []);
      setUsedEngine(data.engine || null);
      toast.success(`${data.count || 0} results found`);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      const msg = (e as Error).message || "Search failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [query, engine, num]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setLoading(false);
  }, []);

  return (
    <div className="space-y-5">
      {/* Query */}
      <div className={cardCls}>
        <Label
          className="text-sm font-bold uppercase tracking-widest mb-3 block"
          style={CODE}
        >
          Query
        </Label>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the web…"
          className={`h-11 ${inputCls} text-sm placeholder:text-foreground/70`}
          style={BODY}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !loading) doSearch();
          }}
        />
      </div>

      {/* Engine & Num */}
      <div className="grid sm:grid-cols-2 gap-5">
        <div className={cardCls}>
          <Label
            className="text-sm font-bold uppercase tracking-widest mb-3 block"
            style={CODE}
          >
            Engine
          </Label>
          <Select value={engine} onValueChange={setEngine}>
            <SelectTrigger className={`h-11 ${inputCls}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-none">
              <SelectItem value="miklium" className="rounded-none" style={BODY}>Miklium</SelectItem>
              <SelectItem value="duckduckgo" className="rounded-none" style={BODY}>DuckDuckGo</SelectItem>
              <SelectItem value="google" className="rounded-none" style={BODY}>Google</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className={cardCls}>
          <Label
            className="text-sm font-bold uppercase tracking-widest mb-3 block"
            style={CODE}
          >
            Results
          </Label>
          <Select value={num} onValueChange={setNum}>
            <SelectTrigger className={`h-11 ${inputCls}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-none">
              {["5", "8", "10", "15", "20"].map((n) => (
                <SelectItem key={n} value={n} className="rounded-none" style={CODE}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Button */}
      <div className="flex gap-2">
        {loading ? (
          <button onClick={cancel} className={`flex-1 ${btnCls}`} style={CODE}>
            <Square className="h-4 w-4" /> Cancel
          </button>
        ) : (
          <button
            onClick={doSearch}
            disabled={!query.trim()}
            className={`flex-1 ${btnCls}`}
            style={CODE}
          >
            <Search className="h-4 w-4" /> Search
          </button>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="border border-foreground p-5 flex items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-foreground" />
          <div className="flex-1">
            <p className="text-sm font-bold" style={BRAND}>Searching…</p>
            <p className="text-xs text-foreground/70" style={BODY}>
              Fetching results from {engine}…
            </p>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="border border-foreground p-5 border-red-500/50">
          <p className="text-sm font-bold text-red-500" style={BRAND}>Error</p>
          <p className="text-xs text-red-400 mt-1" style={BODY}>{error}</p>
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 mb-2">
            <Badge
              variant="outline"
              className="text-[10px] border-foreground text-foreground"
              style={{ borderRadius: 0, ...CODE }}
            >
              {results.length} results
            </Badge>
            {usedEngine && (
              <Badge
                variant="outline"
                className="text-[10px] border-foreground/30 text-foreground/70"
                style={{ borderRadius: 0, ...CODE }}
              >
                {usedEngine}
              </Badge>
            )}
          </div>
          {results.map((r, i) => (
            <div
              key={i}
              className="border border-foreground p-4 hover:bg-foreground hover:text-background transition-colors duration-100 group"
            >
              <a
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-bold text-foreground group-hover:text-background transition-colors duration-100 flex items-center gap-1.5"
                style={BRAND}
              >
                {r.title || "Untitled"}
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
              <p
                className="text-[11px] text-foreground/70 group-hover:text-background/70 mt-1 break-all transition-colors duration-100"
                style={CODE}
              >
                {r.url}
              </p>
              {r.snippet && (
                <p
                  className="text-xs text-muted-foreground group-hover:text-background/70 mt-2 leading-relaxed transition-colors duration-100"
                  style={BODY}
                >
                  {r.snippet}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════
   Image Tools Playground
   ════════════════════════════════════════════ */
function ImageToolsPlayground() {
  const [action, setAction] = useState<ImageActionId>("removebg");
  const [url, setUrl] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [prompt, setPrompt] = useState("");
  const [scale, setScale] = useState("2");
  const [loading, setLoading] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const needsPrompt = action === "nanobanana2";
  const needsFaceSwap = action === "faceswap";
  const needsScale = action === "unblur" || action === "iloveimg";

  const process = useCallback(async () => {
    if (!needsFaceSwap && !url.trim()) {
      toast.error("Please enter an image URL");
      return;
    }
    if (needsFaceSwap && (!sourceUrl.trim() || !targetUrl.trim())) {
      toast.error("Please enter both source and target URLs");
      return;
    }
    if (needsPrompt && !prompt.trim()) {
      toast.error("Please enter a prompt for AI Edit");
      return;
    }

    setLoading(true);
    setError(null);
    setResultUrl(null);
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const body: Record<string, unknown> = { action };

    if (needsFaceSwap) {
      body.source = sourceUrl.trim();
      body.target = targetUrl.trim();
    } else {
      body.url = url.trim();
    }
    if (needsPrompt) body.prompt = prompt.trim();
    if (needsScale) body.scale = parseInt(scale);

    try {
      const res = await fetch("/api/v1/image/mask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      // Extract image URL from response
      const imgUrl =
        data.url ||
        data.image_url ||
        data.output_url ||
        data.result_url ||
        (data.data?.url) ||
        (data.data?.image_url) ||
        null;
      setResultUrl(imgUrl);
      toast.success("Image processed successfully");
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      const msg = (e as Error).message || "Processing failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [action, url, sourceUrl, targetUrl, prompt, scale, needsPrompt, needsFaceSwap, needsScale]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setLoading(false);
  }, []);

  const downloadResult = useCallback(async () => {
    if (!resultUrl) return;
    try {
      const res = await fetch(resultUrl);
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = `${action}-result.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
      toast.success("Downloaded");
    } catch {
      toast.error("Download failed");
    }
  }, [resultUrl, action]);

  return (
    <div className="space-y-5">
      {/* Action selector */}
      <div className={cardCls}>
        <Label
          className="text-sm font-bold uppercase tracking-widest mb-3 block"
          style={CODE}
        >
          Action
        </Label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {IMAGE_ACTIONS.map((a) => {
            const Icon = a.icon;
            const active = action === a.id;
            return (
              <button
                key={a.id}
                onClick={() => setAction(a.id)}
                className={`p-3 border flex items-center gap-2 transition-colors duration-100 text-xs font-medium ${
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "border-foreground/30 text-foreground hover:bg-foreground hover:text-background"
                }`}
                style={CODE}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="truncate">{a.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* URL inputs */}
      {needsFaceSwap ? (
        <div className="grid sm:grid-cols-2 gap-5">
          <div className={cardCls}>
            <Label
              className="text-sm font-bold uppercase tracking-widest mb-3 block"
              style={CODE}
            >
              Source Image URL
            </Label>
            <Input
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="Paste source image URL…"
              className={`h-11 ${inputCls} text-sm placeholder:text-foreground/70`}
              style={CODE}
            />
          </div>
          <div className={cardCls}>
            <Label
              className="text-sm font-bold uppercase tracking-widest mb-3 block"
              style={CODE}
            >
              Target Image URL
            </Label>
            <Input
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="Paste target image URL…"
              className={`h-11 ${inputCls} text-sm placeholder:text-foreground/70`}
              style={CODE}
            />
          </div>
        </div>
      ) : (
        <div className={cardCls}>
          <Label
            className="text-sm font-bold uppercase tracking-widest mb-3 block"
            style={CODE}
          >
            Image URL
          </Label>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste image URL…"
            className={`h-11 ${inputCls} text-sm placeholder:text-foreground/70`}
            style={CODE}
          />
        </div>
      )}

      {/* Prompt (AI Edit) */}
      {needsPrompt && (
        <div className={cardCls}>
          <Label
            className="text-sm font-bold uppercase tracking-widest mb-3 block"
            style={CODE}
          >
            Edit Prompt
          </Label>
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe how to edit the image…"
            className={`min-h-[80px] resize-y ${inputCls} text-sm placeholder:text-foreground/70`}
            style={BODY}
          />
        </div>
      )}

      {/* Scale (unblur, iloveimg) */}
      {needsScale && (
        <div className={cardCls}>
          <Label
            className="text-sm font-bold uppercase tracking-widest mb-3 block"
            style={CODE}
          >
            Scale
          </Label>
          <Select value={scale} onValueChange={setScale}>
            <SelectTrigger className={`h-11 ${inputCls}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-none">
              <SelectItem value="2" className="rounded-none" style={CODE}>2x</SelectItem>
              <SelectItem value="3" className="rounded-none" style={CODE}>3x</SelectItem>
              <SelectItem value="4" className="rounded-none" style={CODE}>4x</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Process button */}
      <div className="flex gap-2">
        {loading ? (
          <button onClick={cancel} className={`flex-1 ${btnCls}`} style={CODE}>
            <Square className="h-4 w-4" /> Cancel
          </button>
        ) : (
          <button
            onClick={process}
            disabled={needsFaceSwap ? (!sourceUrl.trim() || !targetUrl.trim()) : !url.trim()}
            className={`flex-1 ${btnCls}`}
            style={CODE}
          >
            <ImageIcon className="h-4 w-4" /> Process
          </button>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="border border-foreground p-5 flex items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-foreground" />
          <div className="flex-1">
            <p className="text-sm font-bold" style={BRAND}>
              Processing image…
            </p>
            <p className="text-xs text-foreground/70" style={BODY}>
              Applying {IMAGE_ACTIONS.find((a) => a.id === action)?.label} — this may take a moment…
            </p>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="border border-foreground p-5 border-red-500/50">
          <p className="text-sm font-bold text-red-500" style={BRAND}>Error</p>
          <p className="text-xs text-red-400 mt-1" style={BODY}>{error}</p>
        </div>
      )}

      {/* Result */}
      {resultUrl && (
        <div className="border border-foreground overflow-hidden">
          <div className="relative aspect-auto bg-muted">
            <img
              src={resultUrl}
              alt="Processed result"
              className="w-full h-auto max-h-[600px] object-contain"
            />
          </div>
          <div className="p-4 flex items-center justify-between">
            <span
              className="text-xs text-foreground/70 truncate max-w-[60%]"
              style={CODE}
            >
              {resultUrl}
            </span>
            <div className="flex gap-2">
              <a
                href={resultUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="h-8 px-3 bg-foreground text-background flex items-center gap-1.5 uppercase tracking-widest text-xs hover:bg-background hover:text-foreground hover:border-2 hover:border-foreground transition-all duration-100"
                style={CODE}
              >
                <ExternalLink className="h-3 w-3" /> Open
              </a>
              <button
                onClick={downloadResult}
                className="h-8 px-3 bg-foreground text-background flex items-center gap-1.5 uppercase tracking-widest text-xs hover:bg-background hover:text-foreground hover:border-2 hover:border-foreground transition-all duration-100"
                style={CODE}
              >
                <Download className="h-3 w-3" /> Download
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

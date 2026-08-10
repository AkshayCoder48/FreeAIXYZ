"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  Wand2,
  Download,
  RefreshCw,
  Image as ImageIcon,
  Palette,
  Zap,
  Globe,
  Server,
  Loader2,
  X,
  Trash2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

// ── Types ──────────────────────────────────────────────
type Source = "pollinations" | "aianime";

interface GeneratedImage {
  id: string;
  url: string;
  prompt: string;
  source: Source;
  timestamp: number;
  width: number;
  height: number;
}

// ── Style Presets ──────────────────────────────────────
const STYLE_PRESETS = [
  {
    label: "Anime Girl",
    prompt:
      "beautiful anime girl, detailed eyes, flowing hair, soft pastel colors, studio ghibli style, high quality anime art",
    emoji: "👧",
  },
  {
    label: "Cat Girl",
    prompt:
      "cute anime cat girl, neko ears, playful expression, fluffy tail, pastel pink background, kawaii anime style",
    emoji: "🐱",
  },
  {
    label: "Mecha",
    prompt:
      "giant mecha robot anime, detailed mechanical design, glowing energy core, cyberpunk city background, epic anime style",
    emoji: "🤖",
  },
  {
    label: "Fantasy",
    prompt:
      "epic anime fantasy scene, magical kingdom, floating islands, dragons, enchanted forest, detailed anime background art",
    emoji: "🏔️",
  },
  {
    label: "Chibi",
    prompt:
      "super cute chibi anime character, big head small body, sparkly eyes, pastel colors, adorable kawaii style, simple background",
    emoji: "🧸",
  },
  {
    label: "Dark Anime",
    prompt:
      "dark anime scene, gothic atmosphere, mysterious shadows, red moon, dramatic lighting, detailed anime art style",
    emoji: "🌙",
  },
  {
    label: "Sakura",
    prompt:
      "beautiful sakura cherry blossom scene, anime girl under cherry tree, petals falling, soft pink lighting, romantic anime style",
    emoji: "🌸",
  },
  {
    label: "Cyberpunk",
    prompt:
      "cyberpunk anime city, neon lights, rain reflections, futuristic technology, blade runner style anime art, vibrant colors",
    emoji: "🌆",
  },
];

const SIZE_OPTIONS = [
  { label: "512 × 512", width: 512, height: 512 },
  { label: "512 × 768", width: 512, height: 768 },
  { label: "768 × 512", width: 768, height: 512 },
  { label: "1024 × 1024", width: 1024, height: 1024 },
];

// ── Main Page ──────────────────────────────────────────
export default function Home() {
  const [source, setSource] = useState<Source>("pollinations");
  const [prompt, setPrompt] = useState("");
  const [selectedSize, setSelectedSize] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentImage, setCurrentImage] = useState<GeneratedImage | null>(null);
  const [gallery, setGallery] = useState<GeneratedImage[]>([]);
  const [imageLoading, setImageLoading] = useState(false);

  const { width, height } = SIZE_OPTIONS[selectedSize];

  // ── Generate with Pollinations (client-side direct URL) ──
  const generatePollinations = useCallback(() => {
    const seed = Math.floor(Math.random() * 999999999);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&nologo=true&seed=${seed}`;

    const newImage: GeneratedImage = {
      id: `poll-${Date.now()}-${seed}`,
      url: imageUrl,
      prompt,
      source: "pollinations",
      timestamp: Date.now(),
      width,
      height,
    };

    setCurrentImage(newImage);
    setImageLoading(true);
    setIsGenerating(false);

    // Add to gallery after we know the image loads
    // We track loading state via the img onLoad/onError
  }, [prompt, width, height]);

  // ── Generate with AIAnime.io (client-side fetch) ──
  const generateAianime = useCallback(async () => {
    try {
      const formData = new URLSearchParams();
      formData.append("prompt", prompt);
      formData.append("model_type", "anime_io");

      const response = await fetch(
        "https://api.aianime.io/api/image-generate/text2image",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: formData.toString(),
        }
      );

      const data = await response.json();

      if (data.code === 404 || !data.result) {
        toast.error("AIAnime.io returned an error. Falling back to Pollinations.ai");
        // Fallback to Pollinations
        setSource("pollinations");
        generatePollinations();
        return;
      }

      // The result could be a URL or base64
      let imageUrl = "";
      if (typeof data.result === "string") {
        imageUrl = data.result;
      } else if (data.result?.images?.[0]) {
        imageUrl = data.result.images[0];
      } else if (data.result?.url) {
        imageUrl = data.result.url;
      } else if (data.result?.image) {
        imageUrl = data.result.image;
      } else {
        // Try to extract any URL-like string from result
        const resultStr = JSON.stringify(data.result);
        const urlMatch = resultStr.match(/https?:\/\/[^\s"']+/);
        if (urlMatch) {
          imageUrl = urlMatch[0];
        }
      }

      if (!imageUrl) {
        toast.error("Could not extract image from AIAnime.io response. Falling back to Pollinations.ai");
        setSource("pollinations");
        generatePollinations();
        return;
      }

      const newImage: GeneratedImage = {
        id: `ai-${Date.now()}`,
        url: imageUrl,
        prompt,
        source: "aianime",
        timestamp: Date.now(),
        width,
        height,
      };

      setCurrentImage(newImage);
      setImageLoading(true);
      setGallery((prev) => [newImage, ...prev]);
      setIsGenerating(false);
      toast.success("Image generated with AIAnime.io!");
    } catch {
      toast.error("AIAnime.io fetch failed. Falling back to Pollinations.ai");
      setSource("pollinations");
      generatePollinations();
    }
  }, [prompt, width, height, generatePollinations]);

  // ── Main Generate Handler ──
  const handleGenerate = useCallback(() => {
    if (!prompt.trim()) {
      toast.error("Please enter a prompt first!");
      return;
    }

    setIsGenerating(true);

    if (source === "pollinations") {
      generatePollinations();
    } else {
      generateAianime();
    }
  }, [prompt, source, generatePollinations, generateAianime]);

  // ── Image Load Handlers ──
  const handleImageLoad = useCallback(() => {
    setImageLoading(false);
    if (currentImage && currentImage.source === "pollinations") {
      // Check if already in gallery
      setGallery((prev) => {
        if (prev.some((img) => img.id === currentImage.id)) return prev;
        return [currentImage, ...prev];
      });
    }
    toast.success("Image generated successfully! ✨");
  }, [currentImage]);

  const handleImageError = useCallback(() => {
    setImageLoading(false);
    if (currentImage?.source === "pollinations") {
      toast.error("Failed to load image from Pollinations.ai. Try again with a different seed.");
    } else {
      toast.error("Failed to load image. Try a different source or prompt.");
    }
  }, [currentImage]);

  // ── Download Image ──
  const handleDownload = useCallback(
    async (img: GeneratedImage) => {
      try {
        if (img.source === "pollinations") {
          // Fetch the image data for download
          const response = await fetch(img.url);
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `anime-ai-${img.id}.png`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } else {
          // For aianime URLs
          const a = document.createElement("a");
          a.href = img.url;
          a.download = `anime-ai-${img.id}.png`;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
      } catch {
        toast.error("Download failed. Try right-clicking the image to save.");
      }
    },
    []
  );

  // ── Clear Gallery ──
  const clearGallery = useCallback(() => {
    setGallery([]);
    toast("Gallery cleared");
  }, []);

  // ── Remove from Gallery ──
  const removeFromGallery = useCallback((id: string) => {
    setGallery((prev) => prev.filter((img) => img.id !== id));
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* ── Background decorative elements ── */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-fuchsia-500/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-violet-500/5 rounded-full blur-[120px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-pink-500/3 rounded-full blur-[150px]" />
      </div>

      {/* ── Header ── */}
      <header className="relative border-b border-border/50">
        <div className="shimmer-bg absolute inset-0 opacity-30" />
        <div className="relative max-w-6xl mx-auto px-4 py-6 sm:py-8">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="flex items-center justify-center gap-3"
          >
            <motion.div
              animate={{ rotate: [0, 360] }}
              transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
            >
              <Sparkles className="w-7 h-7 sm:w-8 sm:h-8 text-fuchsia-400" />
            </motion.div>
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold gradient-text tracking-tight">
              Anime AI Studio
            </h1>
            <motion.div
              animate={{ rotate: [360, 0] }}
              transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
            >
              <Wand2 className="w-7 h-7 sm:w-8 sm:h-8 text-pink-400" />
            </motion.div>
          </motion.div>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-center text-muted-foreground mt-2 text-sm sm:text-base"
          >
            Free & Unlimited AI Anime Image Generator ✨
          </motion.p>
        </div>
      </header>

      {/* ── Main Content ── */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-6 sm:py-8 space-y-6 sm:space-y-8">
        {/* Source Selector + Prompt Input */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <Card className="glass-card glow-border overflow-hidden">
            <CardContent className="p-4 sm:p-6 space-y-5">
              {/* Source Selector */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Zap className="w-4 h-4 text-fuchsia-400" />
                  AI Source
                </label>
                <Tabs
                  value={source}
                  onValueChange={(v) => setSource(v as Source)}
                  className="w-full"
                >
                  <TabsList className="w-full grid grid-cols-2 bg-muted/50 h-auto p-1">
                    <TabsTrigger
                      value="pollinations"
                      className="data-[state=active]:bg-fuchsia-500/20 data-[state=active]:text-fuchsia-300 flex items-center gap-2 py-2.5 text-sm"
                    >
                      <Server className="w-4 h-4" />
                      <span className="hidden sm:inline">Pollinations AI</span>
                      <span className="sm:hidden">Pollinations</span>
                    </TabsTrigger>
                    <TabsTrigger
                      value="aianime"
                      className="data-[state=active]:bg-pink-500/20 data-[state=active]:text-pink-300 flex items-center gap-2 py-2.5 text-sm"
                    >
                      <Globe className="w-4 h-4" />
                      <span className="hidden sm:inline">AIAnime.io</span>
                      <span className="sm:hidden">AIAnime</span>
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
                <p className="text-xs text-muted-foreground">
                  {source === "pollinations" ? (
                    <span className="flex items-center gap-1">
                      <Server className="w-3 h-3" />
                      Server-side rendering via Pollinations.ai — fast & reliable
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <Globe className="w-3 h-3" />
                      Client-side call to AIAnime.io — browser-only, with auto-fallback
                    </span>
                  )}
                </p>
              </div>

              {/* Prompt Input */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Palette className="w-4 h-4 text-pink-400" />
                  Prompt
                </label>
                <Textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Describe your anime artwork... e.g. 'beautiful anime girl with flowing hair under cherry blossoms'"
                  className="min-h-[100px] sm:min-h-[120px] bg-input/50 border-border/50 focus:border-fuchsia-500/50 focus:ring-fuchsia-500/20 placeholder:text-muted-foreground/50 resize-none"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleGenerate();
                    }
                  }}
                />
              </div>

              {/* Style Presets */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-violet-400" />
                  Style Presets
                </label>
                <div className="flex flex-wrap gap-2">
                  {STYLE_PRESETS.map((preset) => (
                    <motion.button
                      key={preset.label}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => setPrompt(preset.prompt)}
                      className={`px-3 py-1.5 rounded-lg text-sm border transition-all duration-200 ${
                        prompt === preset.prompt
                          ? "bg-fuchsia-500/20 border-fuchsia-500/50 text-fuchsia-300"
                          : "bg-muted/30 border-border/30 text-muted-foreground hover:border-fuchsia-500/30 hover:text-fuchsia-300"
                      }`}
                    >
                      <span className="mr-1.5">{preset.emoji}</span>
                      {preset.label}
                    </motion.button>
                  ))}
                </div>
              </div>

              {/* Size Selector */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <ImageIcon className="w-4 h-4 text-amber-400" />
                  Image Size
                </label>
                <div className="flex flex-wrap gap-2">
                  {SIZE_OPTIONS.map((size, index) => (
                    <motion.button
                      key={size.label}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => setSelectedSize(index)}
                      className={`px-3 py-1.5 rounded-lg text-sm border transition-all duration-200 font-mono ${
                        selectedSize === index
                          ? "bg-violet-500/20 border-violet-500/50 text-violet-300"
                          : "bg-muted/30 border-border/30 text-muted-foreground hover:border-violet-500/30 hover:text-violet-300"
                      }`}
                    >
                      {size.label}
                    </motion.button>
                  ))}
                </div>
              </div>

              {/* Generate Button */}
              <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                <Button
                  onClick={handleGenerate}
                  disabled={isGenerating || !prompt.trim()}
                  className="w-full magic-gradient text-white font-semibold py-5 sm:py-6 text-base sm:text-lg rounded-xl shadow-lg shadow-fuchsia-500/20 hover:shadow-fuchsia-500/40 transition-shadow disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      Generating Magic...
                    </>
                  ) : (
                    <>
                      <Wand2 className="w-5 h-5 mr-2" />
                      Generate Anime Art
                    </>
                  )}
                </Button>
              </motion.div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Current Image Display */}
        <AnimatePresence mode="wait">
          {(currentImage || imageLoading) && (
            <motion.div
              key={currentImage?.id || "loading"}
              initial={{ opacity: 0, y: 20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.98 }}
              transition={{ duration: 0.4 }}
            >
              <Card className="glass-card overflow-hidden">
                <CardContent className="p-4 sm:p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold gradient-text flex items-center gap-2">
                      <Sparkles className="w-5 h-5 text-fuchsia-400" />
                      Generated Artwork
                    </h2>
                    <Badge
                      variant="outline"
                      className={`text-xs ${
                        currentImage?.source === "pollinations"
                          ? "border-fuchsia-500/50 text-fuchsia-300"
                          : "border-pink-500/50 text-pink-300"
                      }`}
                    >
                      {currentImage?.source === "pollinations" ? (
                        <span className="flex items-center gap-1">
                          <Server className="w-3 h-3" />
                          Pollinations.ai
                        </span>
                      ) : (
                        <span className="flex items-center gap-1">
                          <Globe className="w-3 h-3" />
                          AIAnime.io
                        </span>
                      )}
                    </Badge>
                  </div>

                  {/* Image Container */}
                  <div className="relative rounded-xl overflow-hidden bg-muted/20 border border-border/30">
                    {imageLoading && (
                      <div className="absolute inset-0 flex items-center justify-center z-10">
                        <div className="text-center space-y-3">
                          <motion.div
                            animate={{ rotate: 360 }}
                            transition={{
                              duration: 2,
                              repeat: Infinity,
                              ease: "linear",
                            }}
                          >
                            <Sparkles className="w-10 h-10 text-fuchsia-400 mx-auto" />
                          </motion.div>
                          <p className="text-muted-foreground text-sm">
                            Crafting your anime artwork...
                          </p>
                          <Skeleton className="w-48 h-3 mx-auto rounded-full" />
                        </div>
                      </div>
                    )}

                    {currentImage && (
                      <img
                        src={currentImage.url}
                        alt={currentImage.prompt}
                        className="w-full object-contain"
                        style={{
                          maxHeight: "70vh",
                          opacity: imageLoading ? 0.1 : 1,
                          transition: "opacity 0.5s ease",
                        }}
                        onLoad={handleImageLoad}
                        onError={handleImageError}
                      />
                    )}

                    {!currentImage && imageLoading && (
                      <div className="w-full aspect-square max-h-[70vh] flex items-center justify-center">
                        <div className="text-center space-y-3">
                          <motion.div
                            animate={{ rotate: 360 }}
                            transition={{
                              duration: 2,
                              repeat: Infinity,
                              ease: "linear",
                            }}
                          >
                            <Sparkles className="w-10 h-10 text-fuchsia-400 mx-auto" />
                          </motion.div>
                          <p className="text-muted-foreground text-sm">
                            Generating...
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Image Info & Actions */}
                  {currentImage && !imageLoading && (
                    <div className="mt-4 space-y-3">
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        <span className="font-medium text-foreground/80">
                          Prompt:
                        </span>{" "}
                        {currentImage.prompt}
                      </p>
                      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline" className="border-border/40">
                          {currentImage.width} × {currentImage.height}
                        </Badge>
                        <Badge variant="outline" className="border-border/40">
                          {new Date(currentImage.timestamp).toLocaleTimeString()}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          onClick={() => handleDownload(currentImage)}
                          variant="outline"
                          size="sm"
                          className="border-fuchsia-500/30 text-fuchsia-300 hover:bg-fuchsia-500/10"
                        >
                          <Download className="w-4 h-4 mr-1.5" />
                          Download
                        </Button>
                        <Button
                          onClick={handleGenerate}
                          variant="outline"
                          size="sm"
                          className="border-violet-500/30 text-violet-300 hover:bg-violet-500/10"
                        >
                          <RefreshCw className="w-4 h-4 mr-1.5" />
                          Generate Another
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Gallery */}
        {gallery.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <Card className="glass-card overflow-hidden">
              <CardContent className="p-4 sm:p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold gradient-text flex items-center gap-2">
                    <ImageIcon className="w-5 h-5 text-violet-400" />
                    Gallery
                    <Badge
                      variant="outline"
                      className="border-border/40 text-xs"
                    >
                      {gallery.length}
                    </Badge>
                  </h2>
                  <Button
                    onClick={clearGallery}
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="w-4 h-4 mr-1.5" />
                    Clear
                  </Button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-96 overflow-y-auto custom-scrollbar pr-1">
                  {gallery.map((img, index) => (
                    <motion.div
                      key={img.id}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.3, delay: index * 0.05 }}
                      className="group relative aspect-square rounded-lg overflow-hidden border border-border/30 hover:border-fuchsia-500/50 transition-colors cursor-pointer"
                      onClick={() => setCurrentImage(img)}
                    >
                      <img
                        src={img.url}
                        alt={img.prompt}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
                        loading="lazy"
                      />
                      {/* Overlay */}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                        <div className="absolute bottom-0 left-0 right-0 p-2">
                          <p className="text-[10px] sm:text-xs text-white/90 line-clamp-2">
                            {img.prompt}
                          </p>
                          <Badge
                            variant="outline"
                            className={`mt-1 text-[9px] border-white/30 text-white/70 ${
                              img.source === "pollinations"
                                ? ""
                                : ""
                            }`}
                          >
                            {img.source === "pollinations"
                              ? "Pollinations"
                              : "AIAnime"}
                          </Badge>
                        </div>
                      </div>
                      {/* Remove button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFromGallery(img.id);
                        }}
                        className="absolute top-1 right-1 w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-black/60 text-white/70 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive hover:text-white"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </motion.div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </main>

      {/* ── Sticky Footer ── */}
      <footer className="mt-auto border-t border-border/50">
        <div className="shimmer-bg absolute inset-0 opacity-10 pointer-events-none" />
        <div className="relative max-w-6xl mx-auto px-4 py-4 text-center">
          <p className="text-xs sm:text-sm text-muted-foreground">
            Powered by{" "}
            <span className="text-fuchsia-400 font-medium">
              Pollinations.ai
            </span>{" "}
            &{" "}
            <span className="text-pink-400 font-medium">AIAnime.io</span>{" "}
            <span className="text-muted-foreground/50">•</span>{" "}
            Free & Unlimited ✨
          </p>
        </div>
      </footer>
    </div>
  );
}

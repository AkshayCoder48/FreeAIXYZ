"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useSyncExternalStore,
} from "react";
import {
  Bot,
  User,
  Send,
  Square,
  Copy,
  Check,
  Zap,
  AlertCircle,
  Loader2,
  RotateCcw,
  Sparkles,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ModelSelect } from "@/components/landing/model-select";
import { findModel } from "@/lib/providers";
import { Nav } from "@/components/nav";

interface Message {
  role: "user" | "assistant";
  content: string;
  error?: boolean;
}

const DEFAULT_MODEL = "oc-big-pickle";

const PROMPT_SUGGESTIONS = [
  "Explain quantum computing in simple terms",
  "Write a Python function to find prime numbers",
  "What are the latest AI research trends?",
  "Create a haiku about programming",
];

const emptySubscribe = () => () => {};
function useMounted() {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}

export default function ChatPage() {
  const mounted = useMounted();
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  // Streaming is always enabled — no toggle needed
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendChat = useCallback(
    async (history: Message[], controller: AbortController) => {
      const apiMessages = history.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const tools = [
        {
          type: "function" as const,
          function: {
            name: "web_search",
            description: "Search the web for information",
            parameters: {
              type: "object",
              properties: {
                query: { type: "string", description: "Search query" },
              },
              required: ["query"],
            },
          },
        },
      ];

      const res = await fetch("/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "X-No-Buffer": "true",
          "Cache-Control": "no-cache",
        },
        signal: controller.signal,
        body: JSON.stringify({ model, messages: apiMessages, stream: true, tools }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        let parsedMessage: string | null = null;
        try {
          const parsed = JSON.parse(errText);
          parsedMessage = parsed?.error?.message ?? null;
        } catch {}
        throw new Error(
          `HTTP ${res.status}${parsedMessage ? `: ${parsedMessage}` : errText ? `: ${errText.slice(0, 200)}` : ""}`,
        );
      }

      // Streaming is always enabled — parse SSE response
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const json = JSON.parse(data);
            const delta = json?.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta) {
              fullText += delta;
              setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last?.role === "assistant") {
                  next[next.length - 1] = { ...last, content: fullText };
                }
                return next;
              });
            }
          } catch {}
        }
      }
      return fullText;
    },
    [model],
  );

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    const controller = new AbortController();
    abortRef.current = controller;

    const userMsg: Message = { role: "user", content: text };
    const assistantMsg: Message = { role: "assistant", content: "" };
    const history = [...messages, userMsg];
    setMessages([...history, assistantMsg]);
    setInput("");
    setLoading(true);

    try {
      const result = await sendChat(history, controller);
      if (result) {
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant" && !last.content) {
            next[next.length - 1] = { role: "assistant", content: result };
          }
          return next;
        });
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      const msg = (e as Error).message || "Unknown error";
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === "assistant") {
          next[next.length - 1] = {
            role: "assistant",
            content: msg,
            error: true,
          };
        }
        return next;
      });
      toast.error(msg);
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [input, loading, messages, sendChat]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setLoading(false);
  }, []);

  const retry = useCallback(() => {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.error) {
        return prev.slice(0, -1);
      }
      return prev;
    });
  }, []);

  const copyMessage = useCallback(async (text: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 2000);
    } catch {}
  }, []);

  const clearChat = useCallback(() => {
    setMessages([]);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    },
    [send],
  );

  const modelInfo = findModel(model);

  return (
    <div className="relative min-h-screen flex flex-col bg-background overflow-hidden">
      {/* Background blobs */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute h-[60vh] w-[60vh] -top-[10%] -left-[10%] rounded-full bg-[#8B5CF6]/10 blur-3xl animate-clay-float" />
        <div className="absolute h-[50vh] w-[50vh] -right-[10%] top-[20%] rounded-full bg-[#EC4899]/10 blur-3xl animate-clay-float-delayed animation-delay-2000" />
        <div className="absolute h-[40vh] w-[40vh] bottom-[5%] left-[30%] rounded-full bg-[#0EA5E9]/10 blur-3xl animate-clay-float-slow animation-delay-4000" />
      </div>

      <Nav />

      <main className="flex-1 flex flex-col max-w-4xl mx-auto w-full px-4 sm:px-6">
        {/* Model selector bar */}
        <div className="flex items-center gap-3 py-5 border-b border-primary/10">
          <div className="flex-1">
            {mounted && <ModelSelect value={model} onChange={setModel} />}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-[20px] text-xs font-medium bg-gradient-to-br from-purple-400/15 to-purple-600/10 text-primary shadow-clay-pressed">
              <Zap className="h-3 w-3" />
              streaming
            </div>
            {modelInfo?.capabilities?.vision && (
              <Badge variant="secondary" className="text-[10px] gap-1 rounded-[20px]">
                👁 vision
              </Badge>
            )}
            {messages.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground h-8 rounded-[20px] hover:-translate-y-0.5 active:scale-[0.92] active:shadow-clay-pressed transition-all duration-200"
                onClick={clearChat}
              >
                Clear
              </Button>
            )}
          </div>
        </div>

        {/* Messages area */}
        <div className="flex-1 min-h-0 py-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full min-h-[50vh] gap-6">
              <div className="h-16 w-16 rounded-[24px] bg-gradient-to-br from-purple-400 to-purple-600 flex items-center justify-center shadow-clay-button animate-clay-breathe">
                <MessageSquare className="h-8 w-8 text-white" />
              </div>
              <h2
                className="text-2xl sm:text-3xl font-extrabold text-center"
                style={{ fontFamily: "var(--font-brand), sans-serif" }}
              >
                AI Inference Playground
              </h2>
              <p
                className="text-base text-muted-foreground text-center max-w-md leading-relaxed"
                style={{ fontFamily: "var(--font-body), sans-serif" }}
              >
                Select a model and start chatting. All models are free, no API key required.
              </p>
              <div className="flex flex-wrap justify-center gap-3 mt-2">
                {PROMPT_SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      setInput(s);
                      textareaRef.current?.focus();
                    }}
                    className="text-sm text-muted-foreground hover:text-foreground bg-white/50 dark:bg-[#2D2440]/50 shadow-clay-card hover:-translate-y-1 hover:shadow-clay-card-hover rounded-[20px] px-4 py-2 transition-all duration-200 active:scale-[0.92] active:shadow-clay-pressed"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <ScrollArea className="h-full max-h-[calc(100vh-220px)]">
              <div className="space-y-5 pr-2">
                {messages.map((m, i) => (
                  <div
                    key={i}
                    className={cn(
                      "group flex gap-3",
                      m.role === "user" ? "justify-end" : "justify-start"
                    )}
                  >
                    {m.role === "assistant" && (
                      <div className="h-9 w-9 rounded-2xl bg-gradient-to-br from-purple-400 to-purple-600 flex items-center justify-center shrink-0 mt-1 shadow-clay-button">
                        <Bot className="h-4 w-4 text-white" />
                      </div>
                    )}
                    <div
                      className={cn(
                        "rounded-[24px] px-5 py-3.5 max-w-[85%] text-sm leading-relaxed",
                        m.role === "user"
                          ? "bg-gradient-to-br from-[#A78BFA] to-[#7C3AED] text-white shadow-clay-button"
                          : m.error
                            ? "bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 shadow-clay-card"
                            : "bg-white/60 dark:bg-[#2D2440]/60 backdrop-blur-xl shadow-clay-card border border-primary/5"
                      )}
                    >
                      <div className="whitespace-pre-wrap break-words">
                        {m.content || (
                          <span className="flex items-center gap-2 text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Thinking…
                          </span>
                        )}
                      </div>
                      {m.error && (
                        <button
                          onClick={retry}
                          className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <RotateCcw className="h-3 w-3" /> Retry
                        </button>
                      )}
                    </div>
                    {m.role === "user" && (
                      <div className="h-9 w-9 rounded-2xl bg-gradient-to-br from-sky-400 to-sky-600 flex items-center justify-center shrink-0 mt-1 shadow-clay-button">
                        <User className="h-4 w-4 text-white" />
                      </div>
                    )}
                    {m.role === "assistant" && m.content && !m.error && (
                      <button
                        onClick={() => copyMessage(m.content, i)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity h-9 w-9 rounded-[20px] flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/50 dark:hover:bg-[#2D2440]/50 mt-1 shadow-clay-card"
                        title="Copy"
                      >
                        {copiedIdx === i ? (
                          <Check className="h-4 w-4" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </button>
                    )}
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-primary/10 pt-4 pb-4">
          <div className="flex items-end gap-3">
            <div className="flex-1 relative">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Send a message…"
                className="min-h-[56px] max-h-[200px] resize-none rounded-[20px] bg-[#EFEBF5] dark:bg-[#2D2440] shadow-clay-pressed px-5 py-4 text-sm border-0 focus:bg-white dark:focus:bg-[#332B45] focus:ring-4 focus:ring-primary/20 transition-all duration-200 placeholder:text-muted-foreground"
                rows={1}
              />
            </div>
            {loading ? (
              <button
                onClick={cancel}
                className="h-14 w-14 shrink-0 rounded-[20px] bg-gradient-to-br from-red-400 to-red-600 text-white shadow-clay-button hover:-translate-y-1 hover:shadow-clay-button-hover active:scale-[0.92] active:shadow-clay-pressed transition-all duration-200 flex items-center justify-center"
              >
                <Square className="h-5 w-5" />
              </button>
            ) : (
              <button
                onClick={send}
                disabled={!input.trim()}
                className="h-14 w-14 shrink-0 rounded-[20px] bg-gradient-to-br from-[#A78BFA] to-[#7C3AED] text-white shadow-clay-button hover:-translate-y-1 hover:shadow-clay-button-hover active:scale-[0.92] active:shadow-clay-pressed transition-all duration-200 flex items-center justify-center disabled:opacity-50 disabled:hover:translate-y-0 disabled:active:scale-100"
              >
                <Send className="h-5 w-5" />
              </button>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-2 text-center font-medium">
            Press Enter to send, Shift+Enter for new line
          </p>
        </div>
      </main>
    </div>
  );
}

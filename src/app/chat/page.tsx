import { Nav } from "@/components/nav";
import { ChatPlayground } from "@/components/playground/chat-playground";
import { SectionLabel, SiteFooter, FadeIn } from "@/components/site";

export const metadata = {
  title: "Chat Playground — FreeAIXYZ",
  description:
    "Streaming chat playground with TTFT / chunk / duration diagnostics. Real SSE deltas (upstream pacing varies).",
};

export default function ChatPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Nav />

      <main className="flex-1 mx-auto max-w-7xl w-full px-4 sm:px-6 py-8 sm:py-12">
        <FadeIn className="mb-8 flex flex-col gap-3">
          <SectionLabel>Chat playground</SectionLabel>
          <h1 className="text-4xl sm:text-5xl font-normal tracking-tight text-foreground mt-2">
            Send a message. Watch it{" "}
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-[#0052FF] to-[#4D7CFF]">
              stream
            </span>
            .
          </h1>
          <p className="text-sm text-muted-foreground max-w-3xl leading-relaxed">
            Tokens stream from upstream through the proxy to the
            browser parser to the UI — no buffering, no gateway-side re-pacing
            (upstream pacing preserved). Live
            diagnostics show TTFT, chunk count, and duration. Hit{" "}
            <span className="font-medium text-foreground">Stop</span> to abort
            the upstream request mid-stream.
          </p>
        </FadeIn>

        <ChatPlayground />
      </main>

      <SiteFooter>
        <span
          className="font-mono"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          POST /api/v1/chat/completions · stream:true
        </span>
        <span
          className="font-mono"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          GET /api/debug/stream
        </span>
      </SiteFooter>
    </div>
  );
}

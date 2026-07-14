"use client";

import { useState, useSyncExternalStore } from "react";
import { Check, Copy } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const emptySubscribe = () => () => {};

/** Read window.location.origin on the client only (avoids hydration mismatch). */
function useOrigin() {
  return useSyncExternalStore(
    emptySubscribe,
    () => window.location.origin,
    () => "https://your-host",
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="absolute top-2 right-2 h-7 gap-1 text-xs opacity-70 hover:opacity-100"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          toast.success("Copied to clipboard");
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("Copy failed");
        }
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

const SNIPPETS = (origin: string) => ({
  curl: `curl ${origin}/api/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "toolbaz-v4.5-fast",
    "messages": [
      { "role": "system", "content": "You are a helpful assistant." },
      { "role": "user", "content": "Hello!" }
    ],
    "stream": false
  }'`,
  python: `from openai import OpenAI

client = OpenAI(
    base_url="${origin}/api/v1",
    api_key="not-needed",  # no auth required
)

response = client.chat.completions.create(
    model="toolbaz-v4.5-fast",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(response.choices[0].message.content)`,
  javascript: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${origin}/api/v1",
  apiKey: "not-needed", // no auth required
});

const response = await client.chat.completions.create({
  model: "toolbaz-v4.5-fast",
  messages: [{ role: "user", content: "Hello!" }],
});
console.log(response.choices[0].message.content);`,
  stream: `# Streaming with SSE
curl -N ${origin}/api/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "toolbaz-v4.5-fast",
    "stream": true,
    "messages": [{"role": "user", "content": "Count to 5"}]
  }'`,
  tools: `# Function / tool calling
curl ${origin}/api/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "toolbaz-v4.5-fast",
    "messages": [
      {"role": "user", "content": "What is the weather in Boston?"}
    ],
    "tools": [{
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get current weather for a location",
        "parameters": {
          "type": "object",
          "properties": {
            "location": {"type": "string", "description": "City name"}
          },
          "required": ["location"]
        }
      }
    }]
  }'

# response.choices[0].message.tool_calls  -> [{ name: "get_weather", arguments: '{"location":"Boston"}' }]
# finish_reason: "tool_calls"`,
});

const LABELS: Record<string, string> = {
  curl: "cURL",
  python: "Python",
  javascript: "JavaScript",
  stream: "Streaming",
  tools: "Tools",
};

export function CodeExamples() {
  const origin = useOrigin();
  const snippets = SNIPPETS(origin);

  return (
    <Tabs defaultValue="curl" className="w-full">
      <TabsList className="bg-muted/50">
        {Object.keys(snippets).map((k) => (
          <TabsTrigger key={k} value={k} className="text-xs">
            {LABELS[k]}
          </TabsTrigger>
        ))}
      </TabsList>
      {Object.entries(snippets).map(([k, code]) => (
        <TabsContent key={k} value={k} className="relative mt-3">
          <div className="relative rounded-xl border border-border bg-zinc-950 overflow-hidden">
            <div className="flex items-center gap-1.5 px-4 py-2 border-b border-border/60 bg-zinc-900/60">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
              <span className="ml-2 text-[11px] text-muted-foreground font-mono">
                {LABELS[k].toLowerCase()}.sh
              </span>
            </div>
            <pre className="overflow-x-auto p-4 text-[12.5px] leading-relaxed text-zinc-200 font-mono">
              <code>{code}</code>
            </pre>
          </div>
          <CopyButton text={code} />
        </TabsContent>
      ))}
    </Tabs>
  );
}

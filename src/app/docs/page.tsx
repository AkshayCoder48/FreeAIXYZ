"use client";

import { useState, useSyncExternalStore } from "react";
import {
  Check,
  Copy,
  ArrowLeft,
  Zap,
  Menu,
  X,
  Terminal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import Link from "next/link";
import { toast } from "sonner";

// ─── useOrigin hook (client-only window.location.origin) ────────────────────
const emptySubscribe = () => () => {};

/** Read window.location.origin on the client only (avoids hydration mismatch). */
function useOrigin() {
  return useSyncExternalStore(
    emptySubscribe,
    () => window.location.origin,
    () => "https://your-host",
  );
}

// ─── Copy button ────────────────────────────────────────────────────────────
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
      {copied ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

// ─── Code block (single language, no tabs) ──────────────────────────────────
function CodeBlock({
  code,
  filename = "snippet",
}: {
  code: string;
  filename?: string;
}) {
  return (
    <div className="relative rounded-xl border border-border bg-zinc-950 overflow-hidden">
      <div className="flex items-center gap-1.5 px-4 py-2 border-b border-border/60 bg-zinc-900/60">
        <span className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff9a3c]/70" />
        <span className="ml-2 text-[11px] text-muted-foreground font-mono">
          {filename}
        </span>
      </div>
      <pre className="overflow-x-auto p-4 text-[12.5px] leading-relaxed text-zinc-200 font-mono max-h-[520px] overflow-y-auto">
        <code>{code}</code>
      </pre>
      <CopyButton text={code} />
    </div>
  );
}

// ─── Language definitions ───────────────────────────────────────────────────
type Lang =
  | "curl"
  | "python"
  | "javascript"
  | "node"
  | "php"
  | "go"
  | "ruby"
  | "html";

const LANG_ORDER: Lang[] = [
  "curl",
  "python",
  "javascript",
  "node",
  "php",
  "go",
  "ruby",
  "html",
];

const LANG_LABELS: Record<Lang, string> = {
  curl: "cURL",
  python: "Python",
  javascript: "JavaScript",
  node: "Node.js",
  php: "PHP",
  go: "Go",
  ruby: "Ruby",
  html: "HTML",
};

const LANG_FILES: Record<Lang, string> = {
  curl: "request.sh",
  python: "main.py",
  javascript: "main.js",
  node: "index.js",
  php: "index.php",
  go: "main.go",
  ruby: "main.rb",
  html: "index.html",
};

// ─── CodeTabs (multi-language tabbed code viewer) ───────────────────────────
function CodeTabs({ snippets }: { snippets: Record<Lang, string> }) {
  return (
    <Tabs defaultValue="curl" className="w-full">
      <TabsList className="bg-muted/50 flex-wrap h-auto">
        {LANG_ORDER.map((k) => (
          <TabsTrigger key={k} value={k} className="text-xs">
            {LANG_LABELS[k]}
          </TabsTrigger>
        ))}
      </TabsList>
      {LANG_ORDER.map((k) => (
        <TabsContent key={k} value={k} className="mt-3">
          <CodeBlock code={snippets[k]} filename={LANG_FILES[k]} />
        </TabsContent>
      ))}
    </Tabs>
  );
}

// ─── Snippet definitions (one function per section) ─────────────────────────

const chatBasic = (o: string): Record<Lang, string> => ({
  curl: `curl ${o}/api/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "toolbaz-v4.5-fast",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Hello!"}
    ],
    "stream": false
  }'`,
  python: `from openai import OpenAI

client = OpenAI(
    base_url="${o}/api/v1",
    api_key="not-needed",  # no auth required
)

response = client.chat.completions.create(
    model="toolbaz-v4.5-fast",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Hello!"},
    ],
)
print(response.choices[0].message.content)`,
  javascript: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${o}/api/v1",
  apiKey: "not-needed", // no auth required
});

const response = await client.chat.completions.create({
  model: "toolbaz-v4.5-fast",
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Hello!" },
  ],
});
console.log(response.choices[0].message.content);`,
  node: `// Node.js — native fetch (Node 18+)
const res = await fetch("${o}/api/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "toolbaz-v4.5-fast",
    messages: [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Hello!" },
    ],
    stream: false,
  }),
});
const data = await res.json();
console.log(data.choices[0].message.content);`,
  php: `<?php
$ch = curl_init("${o}/api/v1/chat/completions");
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode([
    "model" => "toolbaz-v4.5-fast",
    "messages" => [
        ["role" => "system", "content" => "You are a helpful assistant."],
        ["role" => "user", "content" => "Hello!"],
    ],
    "stream" => false,
]));
curl_setopt($ch, CURLOPT_HTTPHEADER, ["Content-Type: application/json"]);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$response = json_decode(curl_exec($ch), true);
echo $response["choices"][0]["message"]["content"];`,
  go: `package main

import (
    "bytes"
    "encoding/json"
    "fmt"
    "io"
    "net/http"
)

func main() {
    body, _ := json.Marshal(map[string]interface{}{
        "model": "toolbaz-v4.5-fast",
        "messages": []map[string]string{
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": "Hello!"},
        },
        "stream": false,
    })
    res, _ := http.Post("${o}/api/v1/chat/completions", "application/json", bytes.NewBuffer(body))
    defer res.Body.Close()
    raw, _ := io.ReadAll(res.Body)
    var out map[string]interface{}
    json.Unmarshal(raw, &out)
    choices := out["choices"].([]interface{})[0].(map[string]interface{})
    msg := choices["message"].(map[string]interface{})
    fmt.Println(msg["content"])
}`,
  ruby: `require 'net/http'
require 'json'

uri = URI("${o}/api/v1/chat/completions")
res = Net::HTTP.post(uri, {
  model: "toolbaz-v4.5-fast",
  messages: [
    {role: "system", content: "You are a helpful assistant."},
    {role: "user", content: "Hello!"},
  ],
  stream: false,
}.to_json, "Content-Type" => "application/json")

data = JSON.parse(res.body)
puts data["choices"][0]["message"]["content"]`,
  html: `<!-- Drop this into any .html file — works in the browser, no build step -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>FreeGPT Chat</title>
</head>
<body>
  <input id="q" placeholder="Ask me anything..." />
  <button onclick="ask()">Send</button>
  <pre id="out"></pre>
  <script>
    async function ask() {
      const q = document.getElementById('q').value;
      const res = await fetch("${o}/api/v1/chat/completions", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          model: "toolbaz-v4.5-fast",
          messages: [{role: "user", content: q}],
          stream: false,
        }),
      });
      const data = await res.json();
      document.getElementById('out').textContent =
        data.choices[0].message.content;
    }
  </script>
</body>
</html>`,
});

const chatStreaming = (o: string): Record<Lang, string> => ({
  curl: `# Streaming with SSE — use -N to disable output buffering
curl -N ${o}/api/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "toolbaz-v4.5-fast",
    "stream": true,
    "messages": [{"role": "user", "content": "Count to 5"}]
  }'

# Each line looks like:
# data: {"choices":[{"delta":{"content":"1"}}]}
# data: [DONE]`,
  python: `from openai import OpenAI

client = OpenAI(
    base_url="${o}/api/v1",
    api_key="not-needed",
)

stream = client.chat.completions.create(
    model="toolbaz-v4.5-fast",
    messages=[{"role": "user", "content": "Count to 5"}],
    stream=True,
)
for chunk in stream:
    delta = chunk.choices[0].delta.content
    if delta:
        print(delta, end="", flush=True)`,
  javascript: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${o}/api/v1",
  apiKey: "not-needed",
});

const stream = await client.chat.completions.create({
  model: "toolbaz-v4.5-fast",
  messages: [{ role: "user", content: "Count to 5" }],
  stream: true,
});

for await (const chunk of stream) {
  const delta = chunk.choices[0]?.delta?.content;
  if (delta) process.stdout.write(delta);
}`,
  node: `// Node.js — manual SSE parsing with native fetch
const res = await fetch("${o}/api/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "toolbaz-v4.5-fast",
    stream: true,
    messages: [{ role: "user", content: "Count to 5" }],
  }),
});

const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffer = "";

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split("\\n");
  buffer = lines.pop();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (data === "[DONE]") return;
    const json = JSON.parse(data);
    const delta = json.choices?.[0]?.delta?.content;
    if (delta) process.stdout.write(delta);
  }
}`,
  php: `<?php
$ch = curl_init("${o}/api/v1/chat/completions");
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode([
    "model" => "toolbaz-v4.5-fast",
    "stream" => true,
    "messages" => [["role" => "user", "content" => "Count to 5"]],
]));
curl_setopt($ch, CURLOPT_HTTPHEADER, ["Content-Type: application/json"]);
curl_setopt($ch, CURLOPT_WRITEFUNCTION, function ($ch, $chunk) {
    // Each $chunk contains one or more "data: {...}" lines
    foreach (explode("\\n", $chunk) as $line) {
        $line = trim($line);
        if (!str_starts_with($line, "data:")) continue;
        $data = trim(substr($line, 5));
        if ($data === "[DONE]") return strlen($chunk);
        $json = json_decode($data, true);
        $delta = $json["choices"][0]["delta"]["content"] ?? "";
        echo $delta;
        flush();
    }
    return strlen($chunk);
});
curl_exec($ch);`,
  go: `package main

import (
    "bufio"
    "bytes"
    "encoding/json"
    "fmt"
    "net/http"
    "strings"
)

func main() {
    body, _ := json.Marshal(map[string]interface{}{
        "model":  "toolbaz-v4.5-fast",
        "stream": true,
        "messages": []map[string]string{
            {"role": "user", "content": "Count to 5"},
        },
    })
    res, _ := http.Post("${o}/api/v1/chat/completions", "application/json", bytes.NewBuffer(body))
    defer res.Body.Close()

    scanner := bufio.NewScanner(res.Body)
    for scanner.Scan() {
        line := strings.TrimSpace(scanner.Text())
        if !strings.HasPrefix(line, "data:") {
            continue
        }
        data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
        if data == "[DONE]" {
            break
        }
        var chunk map[string]interface{}
        json.Unmarshal([]byte(data), &chunk)
        choices := chunk["choices"].([]interface{})[0].(map[string]interface{})
        if delta, ok := choices["delta"].(map[string]interface{}); ok {
            if c, ok := delta["content"].(string); ok {
                fmt.Print(c)
            }
        }
    }
}`,
  ruby: `require 'net/http'
require 'json'

uri = URI("${o}/api/v1/chat/completions")
req = Net::HTTP::Post.new(uri, "Content-Type" => "application/json")
req.body = {
  model: "toolbaz-v4.5-fast",
  stream: true,
  messages: [{role: "user", content: "Count to 5"}],
}.to_json

Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == "https") do |http|
  http.request(req) do |res|
    res.read_body do |chunk|
      chunk.each_line do |line|
        line = line.strip
        next unless line.start_with?("data:")
        data = line.sub(/^data:/, "").strip
        break if data == "[DONE]"
        json = JSON.parse(data)
        delta = json.dig("choices", 0, "delta", "content")
        print delta if delta
      end
    end
  end
end`,
  html: `<!-- Streaming chat widget (browser SSE parsing) -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>FreeGPT Stream</title>
</head>
<body>
  <input id="q" value="Count to 5" />
  <button onclick="ask()">Send</button>
  <pre id="out"></pre>
  <script>
    async function ask() {
      const out = document.getElementById('out');
      out.textContent = '';
      const res = await fetch("${o}/api/v1/chat/completions", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          model: "toolbaz-v4.5-fast",
          stream: true,
          messages: [{role: "user", content: document.getElementById('q').value}],
        }),
      });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, {stream: true});
        const lines = buffer.split('\\n');
        buffer = lines.pop();
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith('data:')) continue;
          const data = t.slice(5).trim();
          if (data === '[DONE]') continue;
          try {
            const json = JSON.parse(data);
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) out.textContent += delta;
          } catch (e) {}
        }
      }
    }
  </script>
</body>
</html>`,
});

const chatTools = (o: string): Record<Lang, string> => ({
  curl: `# Function / tool calling (non-streaming)
curl ${o}/api/v1/chat/completions \\
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
    }],
    "stream": false
  }'

# Response:
# choices[0].message.tool_calls = [{
#   "id": "call_...",
#   "type": "function",
#   "function": {"name": "get_weather", "arguments": "{\\"location\\":\\"Boston\\"}"}
# }]
# choices[0].finish_reason = "tool_calls"`,
  python: `from openai import OpenAI

client = OpenAI(base_url="${o}/api/v1", api_key="not-needed")

tools = [{
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get current weather for a location",
        "parameters": {
            "type": "object",
            "properties": {
                "location": {"type": "string", "description": "City name"},
            },
            "required": ["location"],
        },
    },
}]

response = client.chat.completions.create(
    model="toolbaz-v4.5-fast",
    messages=[{"role": "user", "content": "What is the weather in Boston?"}],
    tools=tools,
)
call = response.choices[0].message.tool_calls[0]
print(call.function.name, call.function.arguments)
# get_weather {"location": "Boston"}`,
  javascript: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${o}/api/v1",
  apiKey: "not-needed",
});

const tools = [{
  type: "function",
  function: {
    name: "get_weather",
    description: "Get current weather for a location",
    parameters: {
      type: "object",
      properties: {
        location: { type: "string", description: "City name" },
      },
      required: ["location"],
    },
  },
}];

const response = await client.chat.completions.create({
  model: "toolbaz-v4.5-fast",
  messages: [{ role: "user", content: "What is the weather in Boston?" }],
  tools,
});

const call = response.choices[0].message.tool_calls[0];
console.log(call.function.name, call.function.arguments);
// get_weather {"location":"Boston"}`,
  node: `// Node.js — native fetch, non-streaming tool call
const res = await fetch("${o}/api/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "toolbaz-v4.5-fast",
    messages: [{ role: "user", content: "What is the weather in Boston?" }],
    tools: [{
      type: "function",
      function: {
        name: "get_weather",
        description: "Get current weather for a location",
        parameters: {
          type: "object",
          properties: { location: { type: "string", description: "City name" } },
          required: ["location"],
        },
      },
    }],
    stream: false,
  }),
});
const data = await res.json();
const call = data.choices[0].message.tool_calls[0];
console.log(call.function.name, call.function.arguments);`,
  php: `<?php
$ch = curl_init("${o}/api/v1/chat/completions");
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode([
    "model" => "toolbaz-v4.5-fast",
    "messages" => [["role" => "user", "content" => "What is the weather in Boston?"]],
    "tools" => [[
        "type" => "function",
        "function" => [
            "name" => "get_weather",
            "description" => "Get current weather for a location",
            "parameters" => [
                "type" => "object",
                "properties" => ["location" => ["type" => "string", "description" => "City name"]],
                "required" => ["location"],
            ],
        ],
    ]],
    "stream" => false,
]));
curl_setopt($ch, CURLOPT_HTTPHEADER, ["Content-Type: application/json"]);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$data = json_decode(curl_exec($ch), true);
$call = $data["choices"][0]["message"]["tool_calls"][0];
echo $call["function"]["name"] . " " . $call["function"]["arguments"];`,
  go: `package main

import (
    "bytes"
    "encoding/json"
    "fmt"
    "io"
    "net/http"
)

func main() {
    body, _ := json.Marshal(map[string]interface{}{
        "model": "toolbaz-v4.5-fast",
        "messages": []map[string]string{
            {"role": "user", "content": "What is the weather in Boston?"},
        },
        "tools": []map[string]interface{}{
            {
                "type": "function",
                "function": map[string]interface{}{
                    "name":        "get_weather",
                    "description": "Get current weather for a location",
                    "parameters": map[string]interface{}{
                        "type": "object",
                        "properties": map[string]interface{}{
                            "location": map[string]string{"type": "string", "description": "City name"},
                        },
                        "required": []string{"location"},
                    },
                },
            },
        },
        "stream": false,
    })
    res, _ := http.Post("${o}/api/v1/chat/completions", "application/json", bytes.NewBuffer(body))
    defer res.Body.Close()
    raw, _ := io.ReadAll(res.Body)
    var data map[string]interface{}
    json.Unmarshal(raw, &data)
    choices := data["choices"].([]interface{})[0].(map[string]interface{})
    msg := choices["message"].(map[string]interface{})
    calls := msg["tool_calls"].([]interface{})[0].(map[string]interface{})
    fn := calls["function"].(map[string]interface{})
    fmt.Println(fn["name"], fn["arguments"])
}`,
  ruby: `require 'net/http'
require 'json'

uri = URI("${o}/api/v1/chat/completions")
res = Net::HTTP.post(uri, {
  model: "toolbaz-v4.5-fast",
  messages: [{role: "user", content: "What is the weather in Boston?"}],
  tools: [{
    type: "function",
    function: {
      name: "get_weather",
      description: "Get current weather for a location",
      parameters: {
        type: "object",
        properties: {location: {type: "string", description: "City name"}},
        required: ["location"],
      },
    },
  }],
  stream: false,
}.to_json, "Content-Type" => "application/json")

data = JSON.parse(res.body)
call = data["choices"][0]["message"]["tool_calls"][0]
puts call["function"]["name"]  # get_weather
puts call["function"]["arguments"]  # {"location":"Boston"}`,
  html: `<!-- Tool calling from the browser -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>FreeGPT Tools</title>
</head>
<body>
  <input id="q" value="What is the weather in Boston?" />
  <button onclick="ask()">Ask</button>
  <pre id="out"></pre>
  <script>
    async function ask() {
      const res = await fetch("${o}/api/v1/chat/completions", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          model: "toolbaz-v4.5-fast",
          messages: [{role: "user", content: document.getElementById('q').value}],
          tools: [{
            type: "function",
            function: {
              name: "get_weather",
              description: "Get current weather for a location",
              parameters: {
                type: "object",
                properties: {location: {type: "string", description: "City name"}},
                required: ["location"],
              },
            },
          }],
          stream: false,
        }),
      });
      const data = await res.json();
      const call = data.choices[0].message.tool_calls[0];
      document.getElementById('out').textContent =
        call.function.name + "(" + call.function.arguments + ")";
    }
  </script>
</body>
</html>`,
});

const chatToolsStreaming = (o: string): Record<Lang, string> => ({
  curl: `# Streaming tool calls — arguments arrive in fragments across deltas
curl -N ${o}/api/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "toolbaz-v4.5-fast",
    "stream": true,
    "messages": [{"role": "user", "content": "What is the weather in Boston?"}],
    "tools": [{
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get current weather for a location",
        "parameters": {
          "type": "object",
          "properties": {"location": {"type": "string", "description": "City name"}},
          "required": ["location"]
        }
      }
    }]
  }'

# Streaming chunks for tool calls look like:
# data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"get_weather","arguments":""}}]}}]}
# data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"loc"}}]}}]}
# data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ation\\":\\"Boston\\"}"}}]}}]}
# data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}
# data: [DONE]`,
  python: `from openai import OpenAI

client = OpenAI(base_url="${o}/api/v1", api_key="not-needed")

tools = [{
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get current weather for a location",
        "parameters": {
            "type": "object",
            "properties": {"location": {"type": "string", "description": "City name"}},
            "required": ["location"],
        },
    },
}]

stream = client.chat.completions.create(
    model="toolbaz-v4.5-fast",
    messages=[{"role": "user", "content": "What is the weather in Boston?"}],
    tools=tools,
    stream=True,
)

# Accumulate tool_calls across deltas (arguments arrive in fragments)
calls = {}
for chunk in stream:
    delta = chunk.choices[0].delta
    if not getattr(delta, "tool_calls", None):
        continue
    for tc in delta.tool_calls:
        idx = tc.index
        if idx not in calls:
            calls[idx] = {"id": "", "name": "", "arguments": ""}
        if tc.id:
            calls[idx]["id"] = tc.id
        if tc.function and tc.function.name:
            calls[idx]["name"] = tc.function.name
        if tc.function and tc.function.arguments:
            calls[idx]["arguments"] += tc.function.arguments

for c in calls.values():
    print(c["name"], c["arguments"])`,
  javascript: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${o}/api/v1",
  apiKey: "not-needed",
});

const stream = await client.chat.completions.create({
  model: "toolbaz-v4.5-fast",
  messages: [{ role: "user", content: "What is the weather in Boston?" }],
  tools: [{
    type: "function",
    function: {
      name: "get_weather",
      description: "Get current weather for a location",
      parameters: {
        type: "object",
        properties: { location: { type: "string", description: "City name" } },
        required: ["location"],
      },
    },
  }],
  stream: true,
});

const calls = {};
for await (const chunk of stream) {
  const tcs = chunk.choices[0]?.delta?.tool_calls;
  if (!tcs) continue;
  for (const tc of tcs) {
    const idx = tc.index;
    if (!calls[idx]) calls[idx] = { id: "", name: "", arguments: "" };
    if (tc.id) calls[idx].id = tc.id;
    if (tc.function?.name) calls[idx].name = tc.function.name;
    if (tc.function?.arguments) calls[idx].arguments += tc.function.arguments;
  }
}
console.log(Object.values(calls));`,
  node: `// Node.js — manual SSE parsing for streaming tool calls
const res = await fetch("${o}/api/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "toolbaz-v4.5-fast",
    stream: true,
    messages: [{ role: "user", content: "What is the weather in Boston?" }],
    tools: [{
      type: "function",
      function: {
        name: "get_weather",
        description: "Get current weather for a location",
        parameters: {
          type: "object",
          properties: { location: { type: "string", description: "City name" } },
          required: ["location"],
        },
      },
    }],
  }),
});

const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
const calls = {};

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split("\\n");
  buffer = lines.pop();
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const data = t.slice(5).trim();
    if (data === "[DONE]") continue;
    const json = JSON.parse(data);
    const tcs = json.choices?.[0]?.delta?.tool_calls;
    if (!tcs) continue;
    for (const tc of tcs) {
      const idx = tc.index;
      if (!calls[idx]) calls[idx] = { id: "", name: "", arguments: "" };
      if (tc.id) calls[idx].id = tc.id;
      if (tc.function?.name) calls[idx].name = tc.function.name;
      if (tc.function?.arguments) calls[idx].arguments += tc.function.arguments;
    }
  }
}
console.log(Object.values(calls));`,
  php: `<?php
$ch = curl_init("${o}/api/v1/chat/completions");
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode([
    "model" => "toolbaz-v4.5-fast",
    "stream" => true,
    "messages" => [["role" => "user", "content" => "What is the weather in Boston?"]],
    "tools" => [[
        "type" => "function",
        "function" => [
            "name" => "get_weather",
            "description" => "Get current weather for a location",
            "parameters" => [
                "type" => "object",
                "properties" => ["location" => ["type" => "string", "description" => "City name"]],
                "required" => ["location"],
            ],
        ],
    ]],
]));
curl_setopt($ch, CURLOPT_HTTPHEADER, ["Content-Type: application/json"]);

$calls = [];
curl_setopt($ch, CURLOPT_WRITEFUNCTION, function ($ch, $chunk) use (&$calls) {
    foreach (explode("\\n", $chunk) as $line) {
        $line = trim($line);
        if (!str_starts_with($line, "data:")) continue;
        $data = trim(substr($line, 5));
        if ($data === "[DONE]") return strlen($chunk);
        $json = json_decode($data, true);
        $tcs = $json["choices"][0]["delta"]["tool_calls"] ?? null;
        if (!$tcs) continue;
        foreach ($tcs as $tc) {
            $idx = $tc["index"];
            if (!isset($calls[$idx])) $calls[$idx] = ["id" => "", "name" => "", "arguments" => ""];
            if (!empty($tc["id"])) $calls[$idx]["id"] = $tc["id"];
            if (!empty($tc["function"]["name"])) $calls[$idx]["name"] = $tc["function"]["name"];
            if (!empty($tc["function"]["arguments"])) $calls[$idx]["arguments"] .= $tc["function"]["arguments"];
        }
    }
    return strlen($chunk);
});
curl_exec($ch);
print_r(array_values($calls));`,
  go: `package main

import (
    "bufio"
    "bytes"
    "encoding/json"
    "fmt"
    "net/http"
    "strings"
)

type fnRef struct{ Name, Arguments string }

func main() {
    body, _ := json.Marshal(map[string]interface{}{
        "model":  "toolbaz-v4.5-fast",
        "stream": true,
        "messages": []map[string]string{
            {"role": "user", "content": "What is the weather in Boston?"},
        },
        "tools": []map[string]interface{}{
            {
                "type": "function",
                "function": map[string]interface{}{
                    "name":        "get_weather",
                    "description": "Get current weather for a location",
                    "parameters": map[string]interface{}{
                        "type": "object",
                        "properties": map[string]interface{}{
                            "location": map[string]string{"type": "string", "description": "City name"},
                        },
                        "required": []string{"location"},
                    },
                },
            },
        },
    })
    res, _ := http.Post("${o}/api/v1/chat/completions", "application/json", bytes.NewBuffer(body))
    defer res.Body.Close()

    calls := map[int]fnRef{}
    scanner := bufio.NewScanner(res.Body)
    for scanner.Scan() {
        line := strings.TrimSpace(scanner.Text())
        if !strings.HasPrefix(line, "data:") {
            continue
        }
        data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
        if data == "[DONE]" {
            break
        }
        var chunk map[string]interface{}
        json.Unmarshal([]byte(data), &chunk)
        choices := chunk["choices"].([]interface{})[0].(map[string]interface{})
        delta, ok := choices["delta"].(map[string]interface{})
        if !ok {
            continue
        }
        tcs, ok := delta["tool_calls"].([]interface{})
        if !ok {
            continue
        }
        for _, t := range tcs {
            tc := t.(map[string]interface{})
            idx := int(tc["index"].(float64))
            ref := calls[idx]
            if fn, ok := tc["function"].(map[string]interface{}); ok {
                if n, ok := fn["name"].(string); ok {
                    ref.Name = n
                }
                if a, ok := fn["arguments"].(string); ok {
                    ref.Arguments += a
                }
            }
            calls[idx] = ref
        }
    }
    for _, c := range calls {
        fmt.Println(c.Name, c.Arguments)
    }
}`,
  ruby: `require 'net/http'
require 'json'

uri = URI("${o}/api/v1/chat/completions")
req = Net::HTTP::Post.new(uri, "Content-Type" => "application/json")
req.body = {
  model: "toolbaz-v4.5-fast",
  stream: true,
  messages: [{role: "user", content: "What is the weather in Boston?"}],
  tools: [{
    type: "function",
    function: {
      name: "get_weather",
      description: "Get current weather for a location",
      parameters: {
        type: "object",
        properties: {location: {type: "string", description: "City name"}},
        required: ["location"],
      },
    },
  }],
}.to_json

calls = {}
Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == "https") do |http|
  http.request(req) do |res|
    res.read_body do |chunk|
      chunk.each_line do |line|
        line = line.strip
        next unless line.start_with?("data:")
        data = line.sub(/^data:/, "").strip
        break if data == "[DONE]"
        json = JSON.parse(data)
        tcs = json.dig("choices", 0, "delta", "tool_calls")
        next unless tcs
        tcs.each do |tc|
          idx = tc["index"]
          calls[idx] ||= {"id" => "", "name" => "", "arguments" => ""}
          calls[idx]["id"] = tc["id"] if tc["id"]
          if tc["function"]
            calls[idx]["name"] = tc["function"]["name"] if tc["function"]["name"]
            calls[idx]["arguments"] += tc["function"]["arguments"].to_s
          end
        end
      end
    end
  end
end
puts calls.values`,
  html: `<!-- Streaming tool calls in the browser -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>FreeGPT Streaming Tools</title>
</head>
<body>
  <button onclick="ask()">Call get_weather</button>
  <pre id="out"></pre>
  <script>
    async function ask() {
      const out = document.getElementById('out');
      out.textContent = '';
      const res = await fetch("${o}/api/v1/chat/completions", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          model: "toolbaz-v4.5-fast",
          stream: true,
          messages: [{role: "user", content: "What is the weather in Boston?"}],
          tools: [{
            type: "function",
            function: {
              name: "get_weather",
              description: "Get current weather for a location",
              parameters: {
                type: "object",
                properties: {location: {type: "string", description: "City name"}},
                required: ["location"],
              },
            },
          }],
        }),
      });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const calls = {};
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, {stream: true});
        const lines = buffer.split('\\n');
        buffer = lines.pop();
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith('data:')) continue;
          const data = t.slice(5).trim();
          if (data === '[DONE]') continue;
          let json;
          try { json = JSON.parse(data); } catch { continue; }
          const tcs = json.choices?.[0]?.delta?.tool_calls;
          if (!tcs) continue;
          for (const tc of tcs) {
            const idx = tc.index;
            if (!calls[idx]) calls[idx] = {name: '', arguments: ''};
            if (tc.function?.name) calls[idx].name = tc.function.name;
            if (tc.function?.arguments) calls[idx].arguments += tc.function.arguments;
          }
        }
      }
      out.textContent = JSON.stringify(Object.values(calls), null, 2);
    }
  </script>
</body>
</html>`,
});

const modelsList = (o: string): Record<Lang, string> => ({
  curl: `# List all available models
curl ${o}/api/v1/models

# Response:
# {
#   "object": "list",
#   "data": [
#     {"id": "toolbaz-v4.5-fast", "object": "model", "created": 1234567890, "owned_by": "toolbaz"},
#     {"id": "gpt-4o-latest",     "object": "model", "created": 1234567890, "owned_by": "openai"},
#     ... 283 more
#   ]
# }`,
  python: `from openai import OpenAI

client = OpenAI(base_url="${o}/api/v1", api_key="not-needed")

models = client.models.list()
for m in models.data:
    print(m.id, "—", m.owned_by)`,
  javascript: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${o}/api/v1",
  apiKey: "not-needed",
});

const list = await client.models.list();
for (const m of list.data) {
  console.log(m.id, "—", m.owned_by);
}`,
  node: `const res = await fetch("${o}/api/v1/models");
const { data } = await res.json();
console.log(\`Total: \${data.length} models\`);
for (const m of data) {
  console.log(m.id, "—", m.owned_by);
}`,
  php: `<?php
$ch = curl_init("${o}/api/v1/models");
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$data = json_decode(curl_exec($ch), true);
echo "Total: " . count($data["data"]) . " models\\n";
foreach ($data["data"] as $m) {
    echo $m["id"] . " — " . $m["owned_by"] . "\\n";
}`,
  go: `package main

import (
    "encoding/json"
    "fmt"
    "io"
    "net/http"
)

func main() {
    res, _ := http.Get("${o}/api/v1/models")
    defer res.Body.Close()
    raw, _ := io.ReadAll(res.Body)
    var data struct {
        Object string \`json:"object"\`
        Data   []struct {
            ID      string \`json:"id"\`
            OwnedBy string \`json:"owned_by"\`
        } \`json:"data"\`
    }
    json.Unmarshal(raw, &data)
    fmt.Printf("Total: %d models\\n", len(data.Data))
    for _, m := range data.Data {
        fmt.Println(m.ID, "—", m.OwnedBy)
    }
}`,
  ruby: `require 'net/http'
require 'json'

uri = URI("${o}/api/v1/models")
data = JSON.parse(Net::HTTP.get(uri))
puts "Total: #{data['data'].length} models"
data["data"].each { |m| puts "#{m['id']} — #{m['owned_by']}" }`,
  html: `<!-- Fetch and display all models -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>FreeGPT Models</title>
</head>
<body>
  <h2 id="count">Loading...</h2>
  <ul id="list"></ul>
  <script>
    fetch("${o}/api/v1/models")
      .then(r => r.json())
      .then(({data}) => {
        document.getElementById('count').textContent = data.length + ' models';
        const ul = document.getElementById('list');
        for (const m of data) {
          const li = document.createElement('li');
          li.textContent = m.id + ' — ' + m.owned_by;
          ul.appendChild(li);
        }
      });
  </script>
</body>
</html>`,
});

const modelsFilter = (o: string): Record<Lang, string> => ({
  curl: `# Filter by provider — pipe through jq
curl -s ${o}/api/v1/models | \\
  jq '.data[] | select(.owned_by == "toolbaz") | .id'

# Get a unique list of all providers
curl -s ${o}/api/v1/models | jq '[.data[].owned_by] | unique'`,
  python: `from openai import OpenAI

client = OpenAI(base_url="${o}/api/v1", api_key="not-needed")

models = client.models.list().data

# Group by provider
by_provider = {}
for m in models:
    by_provider.setdefault(m.owned_by, []).append(m.id)

for provider, ids in by_provider.items():
    print(f"{provider}: {len(ids)} models")

# Filter to a single provider
toolbaz_models = [m.id for m in models if m.owned_by == "toolbaz"]
print(toolbaz_models)`,
  javascript: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${o}/api/v1",
  apiKey: "not-needed",
});

const all = (await client.models.list()).data;

// Group by provider
const byProvider = {};
for (const m of all) {
  (byProvider[m.owned_by] ??= []).push(m.id);
}
console.log(byProvider);

// Filter to a single provider
const toolbaz = all
  .filter((m) => m.owned_by === "toolbaz")
  .map((m) => m.id);
console.log(toolbaz);`,
  node: `const res = await fetch("${o}/api/v1/models");
const { data } = await res.json();

// Group by provider
const byProvider = data.reduce((acc, m) => {
  (acc[m.owned_by] ??= []).push(m.id);
  return acc;
}, {});

const providers = Object.keys(byProvider);
console.log(\`Providers (\${providers.length}):\`, providers);
console.log("Toolbaz models:", byProvider["toolbaz"]);`,
  php: `<?php
$ch = curl_init("${o}/api/v1/models");
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$data = json_decode(curl_exec($ch), true)["data"];

$byProvider = [];
foreach ($data as $m) {
    $byProvider[$m["owned_by"]][] = $m["id"];
}

foreach ($byProvider as $provider => $ids) {
    echo "$provider: " . count($ids) . " models\\n";
}
echo "Toolbaz models:\\n";
print_r($byProvider["toolbaz"] ?? []);`,
  go: `package main

import (
    "encoding/json"
    "fmt"
    "io"
    "net/http"
    "sort"
)

func main() {
    res, _ := http.Get("${o}/api/v1/models")
    defer res.Body.Close()
    raw, _ := io.ReadAll(res.Body)
    var data struct {
        Data []struct {
            ID      string \`json:"id"\`
            OwnedBy string \`json:"owned_by"\`
        } \`json:"data"\`
    }
    json.Unmarshal(raw, &data)

    byProvider := map[string][]string{}
    for _, m := range data.Data {
        byProvider[m.OwnedBy] = append(byProvider[m.OwnedBy], m.ID)
    }

    keys := make([]string, 0, len(byProvider))
    for k := range byProvider {
        keys = append(keys, k)
    }
    sort.Strings(keys)
    for _, k := range keys {
        fmt.Printf("%s: %d models\\n", k, len(byProvider[k]))
    }
}`,
  ruby: `require 'net/http'
require 'json'

uri = URI("${o}/api/v1/models")
data = JSON.parse(Net::HTTP.get(uri))["data"]

by_provider = data.group_by { |m| m["owned_by"] }
by_provider.each { |p, ms| puts "#{p}: #{ms.length} models" }

puts "Toolbaz models:"
puts by_provider["toolbaz"].map { |m| m["id"] }`,
  html: `<!-- Provider filter dropdown -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Filter by Provider</title>
</head>
<body>
  <select id="provider" onchange="render()"></select>
  <ul id="list"></ul>
  <script>
    let models = [];
    fetch("${o}/api/v1/models")
      .then(r => r.json())
      .then(({data}) => {
        models = data;
        const providers = [...new Set(data.map(m => m.owned_by))].sort();
        const sel = document.getElementById('provider');
        sel.innerHTML = providers.map(p => \`<option>\${p}</option>\`).join("");
        render();
      });
    function render() {
      const p = document.getElementById('provider').value;
      const ul = document.getElementById('list');
      ul.innerHTML = models
        .filter(m => m.owned_by === p)
        .map(m => \`<li>\${m.id}</li>\`).join("");
    }
  </script>
</body>
</html>`,
});

const webSearch = (o: string): Record<Lang, string> => ({
  curl: `# Web search via DuckDuckGo
curl ${o}/api/v1/search \\
  -H "Content-Type: application/json" \\
  -d '{"query": "best AI frameworks 2025", "num": 8}'

# Response shape:
# {
#   "query": "best AI frameworks 2025",
#   "count": 8,
#   "results": [
#     {"title": "...", "url": "https://...", "snippet": "..."},
#     ...
#   ]
# }`,
  python: `import requests

res = requests.post("${o}/api/v1/search", json={
    "query": "best AI frameworks 2025",
    "num": 8,
})
data = res.json()
for r in data["results"]:
    print(r["title"])
    print(" ", r["url"])`,
  javascript: `const res = await fetch("${o}/api/v1/search", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ query: "best AI frameworks 2025", num: 8 }),
});
const { results } = await res.json();
for (const r of results) {
  console.log(r.title);
  console.log(" ", r.url);
}`,
  node: `const res = await fetch("${o}/api/v1/search", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ query: "best AI frameworks 2025", num: 8 }),
});
const data = await res.json();
console.log(\`Found \${data.count} results for "\${data.query}"\`);
for (const r of data.results) {
  console.log("- " + r.title + "\\n  " + r.url);
}`,
  php: `<?php
$ch = curl_init("${o}/api/v1/search");
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode([
    "query" => "best AI frameworks 2025",
    "num" => 8,
]));
curl_setopt($ch, CURLOPT_HTTPHEADER, ["Content-Type: application/json"]);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$data = json_decode(curl_exec($ch), true);
foreach ($data["results"] as $r) {
    echo $r["title"] . "\\n  " . $r["url"] . "\\n";
}`,
  go: `package main

import (
    "bytes"
    "encoding/json"
    "fmt"
    "net/http"
)

func main() {
    body, _ := json.Marshal(map[string]interface{}{
        "query": "best AI frameworks 2025",
        "num":   8,
    })
    res, _ := http.Post("${o}/api/v1/search", "application/json", bytes.NewBuffer(body))
    defer res.Body.Close()
    var data struct {
        Query   string \`json:"query"\`
        Count   int    \`json:"count"\`
        Results []struct {
            Title   string \`json:"title"\`
            URL     string \`json:"url"\`
            Snippet string \`json:"snippet"\`
        } \`json:"results"\`
    }
    json.NewDecoder(res.Body).Decode(&data)
    fmt.Printf("Found %d results for %q\\n", data.Count, data.Query)
    for _, r := range data.Results {
        fmt.Println("- " + r.Title)
        fmt.Println("  " + r.URL)
    }
}`,
  ruby: `require 'net/http'
require 'json'

uri = URI("${o}/api/v1/search")
res = Net::HTTP.post(uri, {query: "best AI frameworks 2025", num: 8}.to_json, "Content-Type" => "application/json")
data = JSON.parse(res.body)
puts "Found #{data['count']} results for \\"#{data['query']}\\""
data["results"].each do |r|
  puts "- #{r['title']}"
  puts "  #{r['url']}"
end`,
  html: `<!-- Web search widget -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>FreeGPT Search</title>
</head>
<body>
  <input id="q" value="best AI frameworks 2025" />
  <button onclick="search()">Search</button>
  <ul id="results"></ul>
  <script>
    async function search() {
      const q = document.getElementById('q').value;
      const res = await fetch("${o}/api/v1/search", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({query: q, num: 8}),
      });
      const {results} = await res.json();
      document.getElementById('results').innerHTML = results
        .map(r => \`<li><a href="\${r.url}" target="_blank">\${r.title}</a><br>\${r.snippet}</li>\`)
        .join("");
    }
  </script>
</body>
</html>`,
});

const music = (o: string): Record<Lang, string> => ({
  curl: `# Generate music and save the returned base64 MP3 to disk
curl ${o}/api/v1/music/generate \\
  -H "Content-Type: application/json" \\
  -d '{
    "prompt": "upbeat electronic dance",
    "lyrics": "In the quiet of the night...",
    "duration": 30,
    "instrumental": false,
    "bpm": 120,
    "key": "C",
    "language": "en"
  }' | \\
  python3 -c "import json,sys,base64; d=json.load(sys.stdin); open('music.mp3','wb').write(base64.b64decode(d['audios'][0]['audio_base64'])); print('Saved music.mp3')"

# Response shape:
# {
#   "success": true,
#   "audios": [{"audio_base64": "<base64 mp3>", "format": "mp3"}],
#   "metadata": "<text description from the model>"
# }`,
  python: `import requests, base64

res = requests.post("${o}/api/v1/music/generate", json={
    "prompt": "lo-fi hip hop with piano",
    "lyrics": "In the quiet of the night...",
    "duration": 30,
    "instrumental": False,
    "bpm": 120,
    "key": "C",
    "language": "en",
})
data = res.json()
if data["success"]:
    audio = base64.b64decode(data["audios"][0]["audio_base64"])
    with open("song.mp3", "wb") as f:
        f.write(audio)
    print("Saved song.mp3")
    print("Metadata:", data["metadata"])
else:
    print("Error:", data.get("error"))`,
  javascript: `// Browser — play audio directly (no file needed)
const res = await fetch("${o}/api/v1/music/generate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    prompt: "upbeat electronic dance",
    duration: 30,
  }),
});
const data = await res.json();
if (data.success) {
  const audio = new Audio("data:audio/mp3;base64," + data.audios[0].audio_base64);
  audio.play();
  console.log("Metadata:", data.metadata);
} else {
  console.error("Error:", data.error);
}`,
  node: `// Node.js — save to file
import fs from "node:fs/promises";

const res = await fetch("${o}/api/v1/music/generate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    prompt: "ambient chill",
    duration: 60,
    instrumental: true,
    bpm: 90,
    key: "Am",
  }),
});
const data = await res.json();
if (data.success) {
  await fs.writeFile(
    "music.mp3",
    Buffer.from(data.audios[0].audio_base64, "base64"),
  );
  console.log("Saved music.mp3");
  console.log("Metadata:", data.metadata);
} else {
  console.error("Error:", data.error);
}`,
  php: `<?php
$ch = curl_init("${o}/api/v1/music/generate");
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode([
    "prompt" => "jazz piano",
    "lyrics" => "Moonlight on the river...",
    "duration" => 30,
    "bpm" => 110,
    "key" => "C",
    "language" => "en",
]));
curl_setopt($ch, CURLOPT_HTTPHEADER, ["Content-Type: application/json"]);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$data = json_decode(curl_exec($ch), true);
if ($data["success"]) {
    file_put_contents("music.mp3", base64_decode($data["audios"][0]["audio_base64"]));
    echo "Saved music.mp3\\n";
    echo "Metadata: " . $data["metadata"] . "\\n";
}`,
  go: `package main

import (
    "bytes"
    "encoding/base64"
    "encoding/json"
    "fmt"
    "net/http"
    "os"
)

func main() {
    body, _ := json.Marshal(map[string]interface{}{
        "prompt":       "rock guitar",
        "duration":     30,
        "instrumental": false,
        "bpm":          130,
        "key":          "E",
    })
    res, _ := http.Post("${o}/api/v1/music/generate", "application/json", bytes.NewBuffer(body))
    defer res.Body.Close()
    var data struct {
        Success bool \`json:"success"\`
        Audios  []struct {
            AudioBase64 string \`json:"audio_base64"\`
            Format      string \`json:"format"\`
        } \`json:"audios"\`
        Metadata string \`json:"metadata"\`
    }
    json.NewDecoder(res.Body).Decode(&data)
    if !data.Success {
        fmt.Println("Generation failed")
        return
    }
    audio, _ := base64.StdEncoding.DecodeString(data.Audios[0].AudioBase64)
    os.WriteFile("music.mp3", audio, 0644)
    fmt.Println("Saved music.mp3")
    fmt.Println("Metadata:", data.Metadata)
}`,
  ruby: `require 'net/http'
require 'json'
require 'base64'

uri = URI("${o}/api/v1/music/generate")
res = Net::HTTP.post(uri, {
  prompt: "classical violin",
  lyrics: "Whispers in the wind...",
  duration: 30,
  bpm: 80,
  key: "G",
  language: "en",
}.to_json, "Content-Type" => "application/json")

data = JSON.parse(res.body)
if data["success"]
  File.write("music.mp3", Base64.decode64(data["audios"][0]["audio_base64"]), mode: "wb")
  puts "Saved music.mp3"
  puts "Metadata: #{data['metadata']}"
end`,
  html: `<!-- Music generation widget with play button -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>FreeGPT Music</title>
</head>
<body>
  <input id="prompt" value="upbeat electronic dance" style="width:300px" />
  <button onclick="generate()">Generate</button>
  <button id="play" disabled onclick="document.getElementById('audio').play()">Play</button>
  <audio id="audio" controls></audio>
  <script>
    async function generate() {
      const play = document.getElementById('play');
      const audio = document.getElementById('audio');
      play.disabled = true;
      audio.src = "";
      const res = await fetch("${o}/api/v1/music/generate", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          prompt: document.getElementById('prompt').value,
          duration: 30,
        }),
      });
      const data = await res.json();
      if (data.success) {
        audio.src = "data:audio/mp3;base64," + data.audios[0].audio_base64;
        play.disabled = false;
      } else {
        alert("Error: " + (data.error || "unknown"));
      }
    }
  </script>
</body>
</html>`,
});

// ─── Sidebar navigation structure ───────────────────────────────────────────
type NavItem = {
  id: string;
  label: string;
  children?: { id: string; label: string }[];
};

const NAV: NavItem[] = [
  { id: "overview", label: "Overview" },
  { id: "authentication", label: "Authentication" },
  {
    id: "chat-completions",
    label: "Chat Completions",
    children: [
      { id: "chat-basic", label: "Basic (non-streaming)" },
      { id: "chat-streaming", label: "Streaming" },
      { id: "chat-tools", label: "Tool Calling (non-streaming)" },
      { id: "chat-tools-streaming", label: "Tool Calling (streaming)" },
    ],
  },
  {
    id: "models",
    label: "Models",
    children: [
      { id: "models-list", label: "List all models" },
      { id: "models-filter", label: "Filter by provider" },
    ],
  },
  { id: "web-search", label: "Web Search" },
  { id: "music", label: "Music Generation" },
  { id: "code-examples", label: "Code Examples" },
];

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="space-y-1 text-sm">
      {NAV.map((item) => (
        <div key={item.id}>
          <a
            href={`#${item.id}`}
            onClick={onNavigate}
            className="block px-3 py-1.5 rounded-md text-muted-foreground hover:text-[#ff9a3c] hover:bg-[#ff9a3c]/5 font-medium"
          >
            {item.label}
          </a>
          {item.children && (
            <div className="ml-3 my-1 border-l border-border/60 pl-3 space-y-0.5">
              {item.children.map((child) => (
                <a
                  key={child.id}
                  href={`#${child.id}`}
                  onClick={onNavigate}
                  className="block px-3 py-1 rounded-md text-muted-foreground/80 hover:text-[#ff9a3c] hover:bg-[#ff9a3c]/5 text-[13px]"
                >
                  {child.label}
                </a>
              ))}
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}

// ─── Main docs page ─────────────────────────────────────────────────────────
export default function DocsPage() {
  const origin = useOrigin();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const snippets = {
    chatBasic: chatBasic(origin),
    chatStreaming: chatStreaming(origin),
    chatTools: chatTools(origin),
    chatToolsStreaming: chatToolsStreaming(origin),
    modelsList: modelsList(origin),
    modelsFilter: modelsFilter(origin),
    webSearch: webSearch(origin),
    music: music(origin),
  };

  const baseUrl = `${origin}/api/v1`;

  return (
    <div className="relative min-h-screen flex flex-col bg-background">
      {/* ambient background */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          backgroundImage:
            "radial-gradient(60% 50% at 50% 0%, rgba(44,224,128,0.10), transparent 70%)",
        }}
      />

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Button asChild variant="ghost" size="sm" className="gap-1.5">
              <Link href="/">
                <ArrowLeft className="h-4 w-4" /> Back to home
              </Link>
            </Button>
            <div className="h-5 w-px bg-border" />
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-[#ff9a3c]/10 border border-[#ff9a3c]/30 flex items-center justify-center">
                <Zap className="h-4 w-4 text-[#ff9a3c]" />
              </div>
              <span className="text-sm font-semibold">API Docs</span>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="lg:hidden"
            onClick={() => setMobileNavOpen((v) => !v)}
            aria-label="Toggle navigation"
          >
            {mobileNavOpen ? (
              <X className="h-4 w-4" />
            ) : (
              <Menu className="h-4 w-4" />
            )}
          </Button>
        </div>
      </header>

      {/* Body: sidebar + content */}
      <div className="mx-auto max-w-7xl w-full px-4 sm:px-6 flex-1 flex">
        {/* Sidebar — desktop (sticky) */}
        <aside className="hidden lg:block w-64 shrink-0 border-r border-border/60 py-8 pr-6 sticky top-16 self-start h-[calc(100vh-4rem)] overflow-y-auto">
          <p className="px-3 mb-3 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            On this page
          </p>
          <Sidebar />
        </aside>

        {/* Sidebar — mobile (overlay drawer) */}
        {mobileNavOpen && (
          <div className="lg:hidden fixed inset-0 top-16 z-30 bg-background/95 backdrop-blur p-4 overflow-y-auto">
            <p className="px-3 mb-3 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              On this page
            </p>
            <Sidebar onNavigate={() => setMobileNavOpen(false)} />
          </div>
        )}

        {/* Content */}
        <main className="flex-1 min-w-0 py-8 lg:pl-8 space-y-16">
          {/* Overview */}
          <section id="overview" className="scroll-mt-20 space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <Badge
                variant="outline"
                className="border-[#ff9a3c]/30 text-[#ff9a3c] bg-[#ff9a3c]/5"
              >
                v1
              </Badge>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
                FreeGPT API Docs
              </h1>
            </div>
            <p className="text-muted-foreground max-w-2xl leading-relaxed">
              A free, OpenAI-compatible gateway with 285+ models across 34
              providers — plus web search and AI music generation. No API key,
              no auth, no rate limits. Point any OpenAI SDK at{" "}
              <code className="text-[#ff9a3c]">{baseUrl}</code> and go.
            </p>

            <div className="grid sm:grid-cols-2 gap-3 pt-2">
              {[
                { label: "Base URL", value: baseUrl },
                { label: "Auth", value: "none — no API key required" },
                { label: "Streaming", value: "SSE (text/event-stream)" },
                { label: "Format", value: "OpenAI-compatible JSON" },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-xl border border-border bg-card/40 p-4"
                >
                  <div className="text-[11px] text-muted-foreground uppercase tracking-wider">
                    {item.label}
                  </div>
                  <div className="mt-1 font-mono text-sm text-foreground break-all">
                    {item.value}
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-border bg-card/40 p-4">
              <h3 className="font-semibold mb-2">Endpoints</h3>
              <ul className="space-y-1.5 text-sm">
                <li>
                  <code className="text-[#ff9a3c]">
                    POST /api/v1/chat/completions
                  </code>{" "}
                  — OpenAI-compatible chat (streaming + non-streaming + tool
                  calling)
                </li>
                <li>
                  <code className="text-[#ff9a3c]">GET /api/v1/models</code> —
                  List all 285+ models
                </li>
                <li>
                  <code className="text-[#ff9a3c]">POST /api/v1/search</code> —
                  DuckDuckGo web search
                </li>
                <li>
                  <code className="text-[#ff9a3c]">
                    POST /api/v1/music/generate
                  </code>{" "}
                  — ACE-Step 1.5 music generation
                </li>
              </ul>
            </div>
          </section>

          {/* Authentication */}
          <section id="authentication" className="scroll-mt-20 space-y-4">
            <h2 className="text-2xl font-bold tracking-tight">Authentication</h2>
            <p className="text-muted-foreground max-w-2xl leading-relaxed">
              The gateway is{" "}
              <strong className="text-foreground">
                wide open by design
              </strong>
              . There is no API key, bearer token, or signup required. All
              token rotation, identity generation, and upstream authentication
              is handled automatically per-request.
            </p>
            <div className="rounded-xl border border-[#ff9a3c]/30 bg-[#ff9a3c]/5 p-4 flex items-start gap-3">
              <Check className="h-5 w-5 text-[#ff9a3c] shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-foreground mb-1">
                  No auth headers needed
                </p>
                <p className="text-muted-foreground">
                  You can still pass{" "}
                  <code className="text-[#ff9a3c]">
                    Authorization: Bearer not-needed
                  </code>{" "}
                  if your OpenAI SDK requires one — it will be ignored.
                </p>
              </div>
            </div>
            <CodeBlock
              filename="auth-example.sh"
              code={`# No special headers required — just Content-Type
curl ${origin}/api/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{"model":"toolbaz-v4.5-fast","messages":[{"role":"user","content":"Hi"}]}'

# Optional (ignored, but SDKs sometimes need it):
# Authorization: Bearer not-needed`}
            />
          </section>

          {/* Chat Completions */}
          <section id="chat-completions" className="scroll-mt-20 space-y-8">
            <div className="space-y-3">
              <h2 className="text-2xl font-bold tracking-tight">
                Chat Completions
              </h2>
              <p className="text-muted-foreground max-w-2xl">
                <code className="text-[#ff9a3c]">
                  POST /api/v1/chat/completions
                </code>{" "}
                — fully OpenAI-compatible. Supports streaming,
                tool/function calling, multi-turn conversations, and 285+
                models.
              </p>
              <CodeBlock
                filename="request-body.json"
                code={`{
  "model": "toolbaz-v4.5-fast",      // required — see GET /api/v1/models
  "messages": [                       // required — OpenAI message array
    {"role": "system", "content": "..."},
    {"role": "user", "content": "..."}
  ],
  "stream": false,                    // optional — default false
  "tools": [...],                     // optional — see Tool Calling
  "temperature": 0.7,                 // optional — passed through
  "max_tokens": 4096                  // optional — passed through
}`}
              />
            </div>

            {/* Basic */}
            <div id="chat-basic" className="scroll-mt-20 space-y-3">
              <h3 className="text-xl font-semibold">
                Basic (non-streaming)
              </h3>
              <p className="text-muted-foreground text-sm max-w-2xl">
                Send a request with{" "}
                <code className="text-[#ff9a3c]">stream: false</code> (the
                default) and get a single JSON response containing the full
                assistant message.
              </p>
              <CodeTabs snippets={snippets.chatBasic} />
            </div>

            {/* Streaming */}
            <div id="chat-streaming" className="scroll-mt-20 space-y-3">
              <h3 className="text-xl font-semibold">Streaming</h3>
              <p className="text-muted-foreground text-sm max-w-2xl">
                Set <code className="text-[#ff9a3c]">stream: true</code> to
                receive Server-Sent Events with token-by-token deltas. Each
                line is{" "}
                <code className="text-[#ff9a3c]">{"data: <json>"}</code>; the
                stream ends with{" "}
                <code className="text-[#ff9a3c]">{"data: [DONE]"}</code>.
              </p>
              <CodeTabs snippets={snippets.chatStreaming} />
            </div>

            {/* Tools (non-streaming) */}
            <div id="chat-tools" className="scroll-mt-20 space-y-3">
              <h3 className="text-xl font-semibold">
                Tool Calling (non-streaming)
              </h3>
              <p className="text-muted-foreground text-sm max-w-2xl">
                Pass an array of{" "}
                <code className="text-[#ff9a3c]">tools</code>. When the model
                decides to call a function,{" "}
                <code className="text-[#ff9a3c]">finish_reason</code> will be{" "}
                <code className="text-[#ff9a3c]">{"\"tool_calls\""}</code> and{" "}
                <code className="text-[#ff9a3c]">message.tool_calls</code> will
                contain the function name + arguments.
              </p>
              <CodeTabs snippets={snippets.chatTools} />
            </div>

            {/* Tools (streaming) */}
            <div id="chat-tools-streaming" className="scroll-mt-20 space-y-3">
              <h3 className="text-xl font-semibold">
                Tool Calling (streaming)
              </h3>
              <p className="text-muted-foreground text-sm max-w-2xl">
                Same tools API, but with{" "}
                <code className="text-[#ff9a3c]">stream: true</code>. Tool
                calls arrive as deltas — you must accumulate{" "}
                <code className="text-[#ff9a3c]">
                  tool_calls[i].function.arguments
                </code>{" "}
                across chunks by{" "}
                <code className="text-[#ff9a3c]">index</code>.
              </p>
              <CodeTabs snippets={snippets.chatToolsStreaming} />
            </div>
          </section>

          {/* Models */}
          <section id="models" className="scroll-mt-20 space-y-8">
            <div className="space-y-2">
              <h2 className="text-2xl font-bold tracking-tight">Models</h2>
              <p className="text-muted-foreground max-w-2xl">
                <code className="text-[#ff9a3c]">GET /api/v1/models</code> —
                returns 285+ models across 34 providers in the OpenAI list
                format.
              </p>
            </div>

            <div id="models-list" className="scroll-mt-20 space-y-3">
              <h3 className="text-xl font-semibold">List all models</h3>
              <p className="text-muted-foreground text-sm max-w-2xl">
                Response format:
              </p>
              <CodeBlock
                filename="response.json"
                code={`{
  "object": "list",
  "data": [
    {
      "id": "toolbaz-v4.5-fast",
      "object": "model",
      "created": 1234567890,
      "owned_by": "toolbaz"
    },
    {
      "id": "gpt-4o-latest",
      "object": "model",
      "created": 1234567890,
      "owned_by": "openai"
    }
    // ... 283 more
  ]
}`}
              />
              <CodeTabs snippets={snippets.modelsList} />
            </div>

            <div id="models-filter" className="scroll-mt-20 space-y-3">
              <h3 className="text-xl font-semibold">Filter by provider</h3>
              <p className="text-muted-foreground text-sm max-w-2xl">
                The <code className="text-[#ff9a3c]">owned_by</code> field gives
                you the provider. Group models by it to filter, count, or
                render provider dropdowns.
              </p>
              <CodeTabs snippets={snippets.modelsFilter} />
            </div>
          </section>

          {/* Web Search */}
          <section id="web-search" className="scroll-mt-20 space-y-4">
            <h2 className="text-2xl font-bold tracking-tight">Web Search</h2>
            <p className="text-muted-foreground max-w-2xl">
              <code className="text-[#ff9a3c]">POST /api/v1/search</code> —
              DuckDuckGo-backed web search. Returns titles, URLs, and snippets.
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="rounded-xl border border-border bg-card/40 p-4">
                <div className="text-[11px] text-muted-foreground uppercase tracking-wider">
                  Request body
                </div>
                <pre className="mt-2 text-[12.5px] text-zinc-200 font-mono">{`{
  "query": "best AI frameworks 2025",
  "num": 8
}`}</pre>
              </div>
              <div className="rounded-xl border border-border bg-card/40 p-4">
                <div className="text-[11px] text-muted-foreground uppercase tracking-wider">
                  Response shape
                </div>
                <pre className="mt-2 text-[12.5px] text-zinc-200 font-mono">{`{
  "query": "best AI frameworks 2025",
  "count": 8,
  "results": [
    {"title": "...", "url": "...", "snippet": "..."}
  ]
}`}</pre>
              </div>
            </div>
            <CodeTabs snippets={snippets.webSearch} />
          </section>

          {/* Music Generation */}
          <section id="music" className="scroll-mt-20 space-y-4">
            <h2 className="text-2xl font-bold tracking-tight">
              Music Generation
            </h2>
            <p className="text-muted-foreground max-w-2xl">
              <code className="text-[#ff9a3c]">
                POST /api/v1/music/generate
              </code>{" "}
              — generate AI music using ACE-Step 1.5. Returns base64-encoded
              MP3 audio you can save to disk or play directly in the browser.
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="rounded-xl border border-border bg-card/40 p-4">
                <div className="text-[11px] text-muted-foreground uppercase tracking-wider">
                  Request body
                </div>
                <pre className="mt-2 text-[12.5px] text-zinc-200 font-mono">{`{
  "prompt": "upbeat electronic dance",       // required
  "lyrics": "In the quiet of the night...",  // optional
  "duration": 30,        // seconds, optional
  "instrumental": false, // optional
  "bpm": 120,            // optional
  "key": "C",            // optional
  "language": "en"       // optional
}`}</pre>
              </div>
              <div className="rounded-xl border border-border bg-card/40 p-4">
                <div className="text-[11px] text-muted-foreground uppercase tracking-wider">
                  Response shape
                </div>
                <pre className="mt-2 text-[12.5px] text-zinc-200 font-mono">{`{
  "success": true,
  "audios": [
    {
      "audio_base64": "<base64 mp3>",
      "format": "mp3"
    }
  ],
  "metadata": "<text description>"
}`}</pre>
              </div>
            </div>
            <p className="text-muted-foreground text-sm">
              Each example below shows how to decode the base64 audio and save
              it to an MP3 file — except the JavaScript tab, which plays the
              audio directly in the browser.
            </p>
            <CodeTabs snippets={snippets.music} />
          </section>

          {/* Code Examples summary */}
          <section id="code-examples" className="scroll-mt-20 space-y-4">
            <h2 className="text-2xl font-bold tracking-tight">
              Code Examples (All Languages)
            </h2>
            <p className="text-muted-foreground max-w-2xl">
              Every API above is documented in 8 languages: cURL, Python,
              JavaScript (browser/SDK), Node.js (native fetch), PHP, Go, Ruby,
              and a copy-paste HTML widget. Jump back to any section above to
              switch tabs.
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {LANG_ORDER.map((lang) => (
                <a
                  key={lang}
                  href="#chat-basic"
                  className="rounded-xl border border-border bg-card/40 hover:border-[#ff9a3c]/40 hover:bg-[#ff9a3c]/5 p-4 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Terminal className="h-4 w-4 text-[#ff9a3c]" />
                    <span className="font-mono text-xs text-[#ff9a3c]">
                      {LANG_FILES[lang]}
                    </span>
                  </div>
                  <div className="mt-2 font-semibold">{LANG_LABELS[lang]}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Click to view a basic example
                  </div>
                </a>
              ))}
            </div>
          </section>
        </main>
      </div>

      {/* Footer */}
      <footer className="border-t border-border/60 py-6 mt-auto">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>
            FreeGPT Gateway — free, OpenAI-compatible, no auth.
          </span>
          <div className="flex items-center gap-3">
            <Link href="/" className="hover:text-[#ff9a3c]">
              Home
            </Link>
            <Link href="/settings" className="hover:text-[#ff9a3c]">
              Settings
            </Link>
            <a href="#overview" className="hover:text-[#ff9a3c]">
              Top
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

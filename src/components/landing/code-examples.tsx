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
  html: `<!-- Fully working HTML chat widget — copy this into any .html file -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FreeGPT Chat</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; background: #0a0a0a; color: #e4e4e7; padding: 20px; }
    .chat-container { max-width: 700px; margin: 0 auto; }
    .header { text-align: center; margin-bottom: 24px; }
    .header h1 { font-size: 1.5rem; color: #10b981; }
    .header p { font-size: 0.85rem; color: #71717a; margin-top: 4px; }
    .model-select { width: 100%; padding: 8px 12px; background: #18181b; border: 1px solid #27272a; border-radius: 8px; color: #e4e4e7; margin-bottom: 16px; font-size: 0.85rem; }
    .messages { min-height: 300px; max-height: 500px; overflow-y: auto; padding: 16px; background: #18181b; border: 1px solid #27272a; border-radius: 12px; margin-bottom: 16px; }
    .msg { margin-bottom: 12px; padding: 10px 14px; border-radius: 10px; font-size: 0.875rem; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
    .msg.user { background: #1e3a5f; margin-left: 40px; }
    .msg.assistant { background: #1a2e1a; margin-right: 40px; }
    .msg .role { font-size: 0.7rem; color: #71717a; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.05em; }
    .input-area { display: flex; gap: 8px; }
    .input-area input { flex: 1; padding: 12px 16px; background: #18181b; border: 1px solid #27272a; border-radius: 8px; color: #e4e4e7; font-size: 0.875rem; outline: none; }
    .input-area input:focus { border-color: #10b981; }
    .input-area button { padding: 12px 24px; background: #10b981; color: #000; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 0.875rem; }
    .input-area button:disabled { opacity: 0.5; cursor: not-allowed; }
    .input-area button:hover:not(:disabled) { background: #059669; }
    .stream-toggle { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; font-size: 0.8rem; color: #71717a; }
    .stream-toggle input { accent-color: #10b981; }
    .typing { color: #10b981; font-style: italic; font-size: 0.8rem; }
  </style>
</head>
<body>
  <div class="chat-container">
    <div class="header">
      <h1>FreeGPT Chat</h1>
      <p>No API key needed — powered by FreeGPT Gateway</p>
    </div>

    <select class="model-select" id="model">
      <option value="toolbaz-v4.5-fast">Toolbaz v4.5 Fast (default)</option>
      <option value="nsfw-llama3-8b">NSFW LLaMA-3 8B (uncensored)</option>
      <option value="nsfw-jollygen">NSFW JollyGen (uncensored roleplay)</option>
      <option value="nsfw-lustre-reasoning">NSFW Lustre Reasoning (uncensored)</option>
      <option value="gpt-5">GPT-5</option>
      <option value="gpt-4o-latest">GPT-4o</option>
      <option value="claude-sonnet-4">Claude Sonnet 4</option>
      <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
      <option value="deepseek-r1">DeepSeek R1 (reasoning)</option>
      <option value="grok-4-fast">Grok 4 Fast</option>
    </select>

    <div class="stream-toggle">
      <input type="checkbox" id="stream" checked>
      <label for="stream">Stream tokens (real-time)</label>
    </div>

    <div class="messages" id="messages">
      <div class="msg assistant"><div class="role">Assistant</div>Hi! I'm a free AI assistant. Ask me anything!</div>
    </div>

    <div class="input-area">
      <input type="text" id="input" placeholder="Type a message..." onkeydown="if(event.key==='Enter')send()">
      <button id="sendBtn" onclick="send()">Send</button>
    </div>
  </div>

  <script>
    const API = "${origin}/api/v1/chat/completions";
    let history = [];

    async function send() {
      const input = document.getElementById('input');
      const msg = input.value.trim();
      if (!msg) return;

      input.value = '';
      document.getElementById('sendBtn').disabled = true;

      // Add user message
      history.push({ role: 'user', content: msg });
      addMessage('user', msg);

      const model = document.getElementById('model').value;
      const useStream = document.getElementById('stream').checked;

      // Add assistant placeholder
      const assistantDiv = addMessage('assistant', '');
      const roleLabel = assistantDiv.querySelector('.role');
      const typing = document.createElement('span');
      typing.className = 'typing';
      typing.textContent = 'typing...';
      assistantDiv.appendChild(typing);

      try {
        if (useStream) {
          // Streaming response
          const res = await fetch(API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, messages: history, stream: true }),
          });

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let fullText = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\\n');
            buffer = lines.pop();
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith('data:')) continue;
              const data = trimmed.slice(5).trim();
              if (data === '[DONE]') continue;
              try {
                const json = JSON.parse(data);
                const delta = json.choices?.[0]?.delta?.content;
                if (delta) {
                  fullText += delta;
                  typing.remove();
                  assistantDiv.lastChild.textContent = fullText;
                }
              } catch (e) {}
            }
          }
          history.push({ role: 'assistant', content: fullText });
          if (!fullText) { typing.textContent = '(empty response)'; }
        } else {
          // Non-streaming response
          const res = await fetch(API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, messages: history, stream: false }),
          });
          const data = await res.json();
          const text = data.choices?.[0]?.message?.content || '(no response)';
          typing.remove();
          assistantDiv.lastChild.textContent = text;
          history.push({ role: 'assistant', content: text });
        }
      } catch (err) {
        typing.remove();
        assistantDiv.lastChild.textContent = 'Error: ' + err.message;
        assistantDiv.style.background = '#3a1a1a';
      }

      document.getElementById('sendBtn').disabled = false;
      input.focus();
    }

    function addMessage(role, content) {
      const div = document.createElement('div');
      div.className = 'msg ' + role;
      const roleLabel = document.createElement('div');
      roleLabel.className = 'role';
      roleLabel.textContent = role;
      const contentDiv = document.createElement('div');
      contentDiv.textContent = content;
      div.appendChild(roleLabel);
      div.appendChild(contentDiv);
      document.getElementById('messages').appendChild(div);
      document.getElementById('messages').scrollTop = 999999;
      return div;
    }
  </script>
</body>
</html>`,
});

const LABELS: Record<string, string> = {
  curl: "cURL",
  python: "Python",
  javascript: "JavaScript",
  stream: "Streaming",
  tools: "Tools",
  html: "HTML",
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
                {k === "html" ? "index.html" : `${LABELS[k].toLowerCase()}.sh`}
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

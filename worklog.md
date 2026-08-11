---
Task ID: 1
Agent: main
Task: Fix simulated streaming in chat playground - find root cause and implement real streaming

Work Log:
- Examined the entire freeaixyz codebase structure at /home/z/freeaixyz
- Read all provider implementations: toolbaz, auroraai, surfsense, jollygen, pollinations, opencode, kilocode, llm7, spicywriter, freechat, swarm, freeaixyz, miklium
- Read the completions route: /src/app/api/v1/chat/completions/route.ts
- Read the playground component: /src/components/landing/playground.tsx
- Read the chat page: /src/app/chat/page.tsx
- Identified 3 root causes of simulated streaming:
  1. Default model was toolbaz-v4.5-fast which doesn't support upstream SSE streaming
  2. isRealStreamProvider() incorrectly included miklium (fake) and unlimitedai (dead)
  3. Non-streaming path used provider.complete() then re-paced with streamText() - fully buffered

Fixes Applied:
- Copied freeaixyz source code into /home/z/my-project
- Fixed isRealStreamProvider(): removed miklium (doesn't truly stream) and unlimitedai (no such provider)
- Changed default model from toolbaz-v4.5-fast to oc-big-pickle (OpenCode.ai - real SSE streaming)
- Updated frontend defaults in playground.tsx and chat/page.tsx
- Rewrote non-streaming provider path to use provider.stream() and send each delta immediately instead of buffering full response then re-pacing

Verification:
- Streaming API test confirmed real token-by-token SSE chunks:
  - "Hello", "!" as separate data: events (OpenCode provider)
  - "Hey", " there", "!", " ", "👋" as separate events (Pollinations provider)
- Keep-alive heartbeats working between tokens
- Landing page loads correctly (HTTP 200)
- Chat playground shows correct default model (oc-big-pickle)

Stage Summary:
- Root cause: Default model (toolbaz) doesn't support upstream streaming + isRealStreamProvider had wrong entries
- Fix: Changed default to OpenCode (real SSE streaming) + fixed isRealStreamProvider + improved non-streaming path
- Real streaming confirmed working via API tests

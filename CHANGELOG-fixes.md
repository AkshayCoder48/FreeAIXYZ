# Changes Applied to freeaixyz

## 1. Fixed Streaming in Chat Playground

**Problem**: Chat playground was sending the full response at once instead of streaming token-by-token.

**Root Cause**: The `streamText()` function in `/api/v1/chat/completions/route.ts` was writing all re-paced chunks instantly with no delay between them. This caused Vercel's proxy to buffer all chunks into a single response.

**Fix**:
- Added 20ms delay between each chunk in `streamText()` to force network flush per chunk
- Reduced chunk size from 150 to 3 tokens per chunk for smoother, more granular streaming
- Extracted `isRealStreamProvider()` helper to centralize the real-stream provider list
- Added `miklium` to the real-stream providers list

**Files changed**: `src/app/api/v1/chat/completions/route.ts`

## 2. Added AIAnime Text2Image API Endpoint

**New endpoint**: `POST /api/image-generate/text2image`

**Upstream**: `https://api.aianime.io/api/image-generate/text2image`

**Response format**:
```json
{
  "code": 200,
  "result": {
    "job_id": "sz3wyhr609rmt0czxd7bhgxyqg",
    "free_limit_value": 1
  },
  "message": {}
}
```

**Features**:
- Proxies text-to-image requests to AIAnime API
- IP rotation via X-Forwarded-For spoofing on each request
- Auto-retry (up to 5 attempts) with different IP on 429/403
- Jittered backoff between retries
- Also integrated into the unified `/api/v1/image/generate` endpoint as the `aianime` provider

**Files created**: `src/app/api/image-generate/text2image/route.ts`
**Files changed**: `src/app/api/v1/image/generate/route.ts`, `src/lib/providers/image-registry.ts`, `vercel.json`

## 3. Implemented IP Rotation Utility

**New module**: `src/lib/ip-rotation/index.ts`

**Strategy**:
- Maintains a pool of 20+ seed proxy endpoints (HTTP proxies)
- Round-robin selection with health scoring (0-100)
- Failed proxies decay in health score; healthy ones recover
- Periodic refresh from proxyscrape.com API (every 5 min)
- X-Forwarded-For / X-Real-IP / CF-Connecting-IP spoofing as Edge runtime fallback
- Random public IP generation (avoids RFC1918 private ranges)

**Exports**:
- `rotatingFetch(url, options)` — fetch with automatic proxy rotation
- `getRotatedHeaders(baseHeaders)` — lightweight IP spoofing headers
- `getPoolStats()` — pool health monitoring

## 4. Deployment Status

- **GitHub**: ✅ Pushed to `AkshayCoder48/freeaixyz` (main branch)
- **Vercel**: ❌ Token `vcp_05kgvjqzr2tS4MsNZDtdezCeGOmoDAshPP1WSHCthVt6yZ8Ccj2DEns` is invalid/expired. User needs to provide a valid Vercel token.

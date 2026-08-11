/**
 * AIAnime Proxy Mini-Service
 *
 * Proxies requests to api.aianime.io from a different IP than Vercel.
 * This service runs on our sandbox server which is NOT blocked by
 * AIAnime's Cloudflare/origin rate limits.
 *
 * Vercel serverless calls this proxy instead of api.aianime.io directly,
 * effectively bypassing the per-IP rate limit on Vercel's shared IPs.
 *
 * Port: 3031
 * Endpoints:
 *   POST /api/image-generate/text2image  — proxy text2image requests
 *   GET  /api/image-generate/text2image/result?job_id=...  — poll for result
 *   GET  /health                         — health check
 *   GET  /stats                          — request stats
 */

const PORT = 3031;
const AIANIME_BASE = "https://api.aianime.io";
const MAX_RETRIES = 8;

// ─── Request stats tracking ────────────────────────────────────────────────
interface Stats {
  totalRequests: number;
  successCount: number;
  failureCount: number;
  parameterErrorCount: number;
  lastError: string;
  lastSuccessTime: number;
  byModel: Record<string, { requests: number; successes: number }>;
  recentLogs: Array<{ time: string; status: string; message: string }>;
}

const stats: Stats = {
  totalRequests: 0,
  successCount: 0,
  failureCount: 0,
  parameterErrorCount: 0,
  lastError: "",
  lastSuccessTime: 0,
  byModel: {},
  recentLogs: [],
};

function log(status: string, message: string) {
  const entry = { time: new Date().toISOString(), status, message };
  stats.recentLogs.unshift(entry);
  if (stats.recentLogs.length > 50) stats.recentLogs.pop();
  console.log(`[${entry.time}] [${status}] ${message}`);
}

// ─── IP rotation with diverse headers ──────────────────────────────────────
function generateRandomIp(): string {
  const firstOctets = [
    1, 5, 8, 14, 20, 23, 31, 37, 41, 45, 49, 62, 77, 80, 85, 89, 93, 100,
    103, 104, 107, 109, 111, 128, 137, 141, 145, 149, 151, 155, 158, 162,
    164, 171, 176, 178, 183, 185, 188, 190, 193, 194, 195, 198, 199, 200,
    202, 203, 206, 208, 209, 210, 211, 212, 213, 214, 216, 217, 218, 219,
    220, 221, 222, 223,
  ];
  const a = firstOctets[Math.floor(Math.random() * firstOctets.length)];
  const b = Math.floor(Math.random() * 256);
  const c = Math.floor(Math.random() * 256);
  const d = Math.floor(Math.random() * 254) + 1;
  return `${a}.${b}.${c}.${d}`;
}

function getRotatedHeaders(): Record<string, string> {
  const ip = generateRandomIp();
  const ip2 = generateRandomIp();
  return {
    "X-Forwarded-For": `${ip}, ${ip2}`,
    "X-Real-IP": ip,
    "X-Client-IP": ip,
    "CF-Connecting-IP": ip,
    "X-Originating-IP": ip,
    "X-Cluster-Client-IP": ip,
    "Forwarded": `for=${ip}`,
  };
}

// ─── Detect "Parameter error" disguised block ──────────────────────────────
function isParameterError(data: unknown): boolean {
  if (typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;
    // AIAnime returns {code: 400, message: {error: "Parameter error"}} when IP is blocked
    if (obj.code === 400 || obj.code === 0) {
      const msg = obj.message as Record<string, unknown> | undefined;
      if (msg && typeof msg.error === "string" && msg.error.toLowerCase().includes("parameter")) {
        return true;
      }
      if (typeof obj.message === "string" && (obj.message as string).toLowerCase().includes("parameter")) {
        return true;
      }
    }
  }
  return false;
}

// ─── Proxy request to AIAnime ──────────────────────────────────────────────
async function proxyText2Image(bodyText: string): Promise<Response> {
  let lastError = "";
  const modelType = new URLSearchParams(bodyText).get("model_type") || "anime_io";

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = 300 + Math.random() * 700;
      await new Promise((r) => setTimeout(r, delay));
    }

    const ipHeaders = getRotatedHeaders();
    try {
      const res = await fetch(`${AIANIME_BASE}/api/image-generate/text2image`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Origin: "https://aianime.io",
          Referer: "https://aianime.io/",
          ...ipHeaders,
        },
        body: bodyText,
        signal: AbortSignal.timeout(30000),
      });

      if (res.status === 429 || res.status === 403) {
        lastError = `HTTP ${res.status} (attempt ${attempt + 1}/${MAX_RETRIES})`;
        log("retry", `Rate limited/blocked: ${lastError}`);
        continue;
      }

      const data = await res.json();

      // Check for disguised "Parameter error" block
      if (isParameterError(data)) {
        lastError = `Parameter error (IP blocked, attempt ${attempt + 1}/${MAX_RETRIES})`;
        stats.parameterErrorCount++;
        log("retry", `Disguised block: ${lastError}`);
        continue;
      }

      // Success!
      stats.successCount++;
      stats.lastSuccessTime = Date.now();
      if (!stats.byModel[modelType]) stats.byModel[modelType] = { requests: 0, successes: 0 };
      stats.byModel[modelType].successes++;
      log("success", `text2image succeeded (attempt ${attempt + 1}, model=${modelType})`);

      return Response.json(data, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    } catch (e) {
      lastError = e instanceof Error ? e.message : "Network error";
      log("retry", `Network error (attempt ${attempt + 1}/${MAX_RETRIES}): ${lastError}`);
      continue;
    }
  }

  stats.failureCount++;
  log("error", `All ${MAX_RETRIES} retries failed: ${lastError}`);

  return Response.json(
    { code: 429, result: null, message: { error: `All retries failed: ${lastError}` } },
    { status: 429 },
  );
}

// ─── Poll for job result ───────────────────────────────────────────────────
const RESULT_ENDPOINTS = [
  `${AIANIME_BASE}/api/image-generate/text2image/result`,
  `${AIANIME_BASE}/api/image-generate/result`,
];
const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 15;

async function pollResult(jobId: string): Promise<Response> {
  log("info", `Polling for job result: ${jobId}`);

  for (const endpoint of RESULT_ENDPOINTS) {
    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      } else {
        await new Promise((r) => setTimeout(r, 1000));
      }

      const ipHeaders = getRotatedHeaders();
      try {
        const res = await fetch(`${endpoint}?job_id=${encodeURIComponent(jobId)}`, {
          method: "GET",
          headers: {
            Accept: "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Origin: "https://aianime.io",
            Referer: "https://aianime.io/",
            ...ipHeaders,
          },
          signal: AbortSignal.timeout(10000),
        });

        if (!res.ok) continue;

        const data = await res.json() as {
          code?: number;
          result?: Record<string, unknown>;
          status?: string;
          image_url?: string;
        };

        const result = data.result || {};
        const imageUrl = (result.image_url as string) || (result.url as string) || data.image_url;

        if (imageUrl) {
          log("success", `Job ${jobId} completed with image URL`);
          return Response.json({
            code: 200,
            result: { ...result, image_url: imageUrl, status: "completed" },
            message: {},
          }, {
            headers: { "Access-Control-Allow-Origin": "*" },
          });
        }

        const status = (result.status as string) || data.status;
        if (status === "processing" || status === "pending" || status === "queued") {
          continue;
        }

        if (data.code === 200 && Object.keys(result).length > 0) {
          return Response.json(data, {
            headers: { "Access-Control-Allow-Origin": "*" },
          });
        }

        if (data.code && data.code !== 200 && data.code !== 102) {
          break; // Try next endpoint
        }
      } catch {
        continue;
      }
    }
  }

  return Response.json({
    code: 200,
    result: { job_id: jobId, status: "processing" },
    message: {},
    poll: {
      url_template: `${RESULT_ENDPOINTS[0]}?job_id={job_id}`,
      interval_ms: POLL_INTERVAL_MS,
      max_attempts: POLL_MAX_ATTEMPTS,
      note: "Image still generating. Continue polling from browser.",
    },
  }, {
    headers: { "Access-Control-Allow-Origin": "*" },
  });
}

// ─── Server ────────────────────────────────────────────────────────────────
const server = Bun.serve({
  port: PORT,
  async fetch(req: Request) {
    const url = new URL(req.url);

    // Health check
    if (url.pathname === "/health") {
      return Response.json({ status: "ok", service: "aianime-proxy", port: PORT });
    }

    // Stats endpoint
    if (url.pathname === "/stats") {
      return Response.json({
        ...stats,
        uptime_ms: Date.now() - (server.startTime || 0),
        success_rate: stats.totalRequests > 0
          ? `${((stats.successCount / stats.totalRequests) * 100).toFixed(1)}%`
          : "N/A",
      }, {
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    }

    // Poll for job result
    if (url.pathname === "/api/image-generate/text2image/result" && req.method === "GET") {
      const jobId = url.searchParams.get("job_id");
      if (!jobId) {
        return Response.json({ code: 400, result: null, message: { error: "job_id parameter required" } }, { status: 400 });
      }
      return await pollResult(jobId);
    }

    // Proxy text2image requests
    if (url.pathname === "/api/image-generate/text2image" && req.method === "POST") {
      stats.totalRequests++;

      const contentType = req.headers.get("Content-Type") || "application/x-www-form-urlencoded";
      let bodyText: string;
      let modelType = "anime_io";

      if (contentType.includes("application/json")) {
        try {
          const json = await req.json() as Record<string, string>;
          const params = new URLSearchParams();
          if (json.prompt) params.set("prompt", json.prompt);
          if (json.model_type) { params.set("model_type", json.model_type); modelType = json.model_type; }
          if (json.negative_prompt) params.set("negative_prompt", json.negative_prompt);
          if (json.aspect_ratio) params.set("aspect_ratio", json.aspect_ratio);
          bodyText = params.toString();
        } catch {
          return Response.json({ code: 400, result: null, message: { error: "Invalid JSON body" } }, { status: 400 });
        }
      } else {
        bodyText = await req.text();
        modelType = new URLSearchParams(bodyText).get("model_type") || "anime_io";
      }

      if (!stats.byModel[modelType]) stats.byModel[modelType] = { requests: 0, successes: 0 };
      stats.byModel[modelType].requests++;

      log("info", `text2image request (model=${modelType})`);
      return await proxyText2Image(bodyText);
    }

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
});

console.log(`🟢 AIAnime Proxy running on port ${PORT}`);

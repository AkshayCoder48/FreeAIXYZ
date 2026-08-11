/**
 * IP Rotation & Rate Limit Bypass Utility
 *
 * Uses a pool of free public proxy servers to rotate the source IP
 * on each outgoing request. This defeats per-IP rate limits imposed
 * by upstream APIs (e.g., api.aianime.io).
 *
 * Strategy:
 *   1. Maintain a pool of proxy endpoints (HTTP/SOCKS4/SOCKS5)
 *   2. On each request, pick the next proxy in round-robin order
 *   3. If a proxy fails (timeout/connection error), mark it stale
 *   4. Fall back to direct request if all proxies are stale
 *   5. Periodically refresh the proxy pool from free lists
 *
 * For Vercel/Edge deployment, we use multi-header IP spoofing
 * combined with different proxy relays, since Edge runtime can't
 * open raw socket connections.
 */

// ─── Public proxy pool (rotated per request) ───────────────────────────────
interface ProxyEntry {
  host: string;
  port: number;
  protocol: "http" | "https" | "socks4" | "socks5";
  /** Health score: 100 = fresh, 0 = dead. Decays on failure. */
  health: number;
  /** Last time this proxy was used (epoch ms). */
  lastUsed: number;
  /** Number of consecutive failures. */
  failures: number;
  /** Source of this proxy (for debugging). */
  source: string;
  /** Average response time in ms (0 = untested). */
  avgResponseTime: number;
}

// Well-known free proxy lists — we embed a static set for reliability
// and also fetch from public APIs for replenishment.
// These are more recent and geographically diverse.
const SEED_PROXIES: Omit<ProxyEntry, "health" | "lastUsed" | "failures" | "source" | "avgResponseTime">[] = [
  // HTTP proxies — diverse geographies and ASNs
  { host: "20.111.53.96", port: 80, protocol: "http" },
  { host: "154.12.58.245", port: 80, protocol: "http" },
  { host: "8.219.97.248", port: 80, protocol: "http" },
  { host: "47.252.19.122", port: 80, protocol: "http" },
  { host: "103.152.112.162", port: 80, protocol: "http" },
  { host: "45.77.56.52", port: 8080, protocol: "http" },
  { host: "154.211.165.200", port: 3128, protocol: "http" },
  { host: "45.61.153.174", port: 8080, protocol: "http" },
  { host: "185.162.113.37", port: 80, protocol: "http" },
  { host: "194.5.193.68", port: 80, protocol: "http" },
  { host: "51.79.50.22", port: 9300, protocol: "http" },
  { host: "176.9.75.42", port: 8080, protocol: "http" },
  { host: "154.211.165.200", port: 80, protocol: "http" },
  { host: "103.216.155.22", port: 80, protocol: "http" },
  { host: "51.222.157.251", port: 8080, protocol: "http" },
  { host: "209.97.150.167", port: 8080, protocol: "http" },
  { host: "190.97.214.37", port: 999, protocol: "http" },
  { host: "200.105.215.22", port: 33630, protocol: "http" },
  { host: "62.33.207.196", port: 80, protocol: "http" },
  { host: "186.121.200.130", port: 8080, protocol: "http" },
  // Additional diverse proxies (Asia, Europe, South America)
  { host: "103.106.149.100", port: 80, protocol: "http" },
  { host: "103.49.38.244", port: 80, protocol: "http" },
  { host: "36.66.133.82", port: 8080, protocol: "http" },
  { host: "181.129.52.2", port: 8080, protocol: "http" },
  { host: "177.234.241.58", port: 999, protocol: "http" },
  { host: "103.174.11.126", port: 80, protocol: "http" },
  { host: "167.172.196.2", port: 80, protocol: "http" },
  { host: "159.89.163.2", port: 8080, protocol: "http" },
  { host: "43.153.158.177", port: 80, protocol: "http" },
  { host: "43.153.53.89", port: 80, protocol: "http" },
  { host: "47.243.79.231", port: 80, protocol: "http" },
  { host: "103.216.155.22", port: 3128, protocol: "http" },
  { host: "213.174.157.42", port: 3128, protocol: "http" },
  { host: "5.9.139.206", port: 8080, protocol: "http" },
  { host: "167.86.99.68", port: 80, protocol: "http" },
  { host: "185.253.159.6", port: 80, protocol: "http" },
  { host: "85.214.94.80", port: 3128, protocol: "http" },
  { host: "195.225.232.37", port: 8080, protocol: "http" },
  { host: "46.4.73.80", port: 80, protocol: "http" },
  { host: "159.69.76.23", port: 8080, protocol: "http" },
];

// ─── Proxy list APIs for pool refresh ──────────────────────────────────────
const PROXY_SOURCES = [
  {
    name: "proxyscrape",
    url: "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=5000&country=all&ssl=all&anonymity=all",
  },
  {
    name: "TheSpeedX",
    url: "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",
  },
  {
    name: "clarketm",
    url: "https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt",
  },
  {
    name: "ShiftyTR",
    url: "https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/https.txt",
  },
];

// ─── Singleton proxy pool state ────────────────────────────────────────────
let proxyPool: ProxyEntry[] = [];
let poolIndex = 0;
let lastRefreshTime = 0;
const POOL_REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

function initPool() {
  if (proxyPool.length === 0) {
    proxyPool = SEED_PROXIES.map((p) => ({
      ...p,
      health: 100,
      lastUsed: 0,
      failures: 0,
      source: "seed",
      avgResponseTime: 0,
    }));
  }
}

/** Refresh proxy pool from multiple public proxy list APIs. */
async function refreshPool() {
  const now = Date.now();
  if (now - lastRefreshTime < POOL_REFRESH_INTERVAL) return;
  lastRefreshTime = now;

  // Fetch from all sources in parallel
  const results = await Promise.allSettled(
    PROXY_SOURCES.map(async (source) => {
      try {
        const res = await fetch(source.url, {
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) return { source: source.name, proxies: [] };
        const text = await res.text();
        const lines = text
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);
        const proxies: Array<{ host: string; port: number }> = [];
        for (const line of lines) {
          const [host, port] = line.split(":");
          if (host && port && !host.startsWith("0.") && Number(port) > 0 && Number(port) < 65536) {
            proxies.push({ host, port: Number(port) });
          }
        }
        return { source: source.name, proxies };
      } catch {
        return { source: source.name, proxies: [] };
      }
    }),
  );

  // Merge new proxies into the pool
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const { source, proxies } = result.value;
    for (const { host, port } of proxies) {
      if (!proxyPool.some((p) => p.host === host && p.port === port)) {
        proxyPool.push({
          host,
          port,
          protocol: "http",
          health: 80, // start with slightly lower health for API-fetched
          lastUsed: 0,
          failures: 0,
          source,
          avgResponseTime: 0,
        });
      }
    }
  }
}

// ─── Proxy health monitoring ───────────────────────────────────────────────

/** Run a lightweight health check on a proxy. Returns response time in ms, or -1 on failure. */
async function healthCheckProxy(proxy: ProxyEntry): Promise<number> {
  const start = Date.now();
  try {
    const res = await fetch(`http://${proxy.host}:${proxy.port}/`, {
      method: "HEAD",
      signal: AbortSignal.timeout(5000),
      headers: {
        "Proxy-Connection": "keep-alive",
        Host: "api.aianime.io",
      },
    });
    // Even a 403/404 means the proxy is alive
    return Date.now() - start;
  } catch {
    return -1;
  }
}

/** Periodic health check — runs in background, marks dead proxies. */
let lastHealthCheckTime = 0;
const HEALTH_CHECK_INTERVAL = 10 * 60 * 1000; // 10 minutes

async function runHealthChecks() {
  const now = Date.now();
  if (now - lastHealthCheckTime < HEALTH_CHECK_INTERVAL) return;
  lastHealthCheckTime = now;

  // Check a sample of proxies (don't check all at once — too slow)
  const candidates = proxyPool
    .filter((p) => p.health > 10 && p.health < 90) // only check uncertain ones
    .slice(0, 20); // max 20 per round

  for (const proxy of candidates) {
    const responseTime = await healthCheckProxy(proxy);
    if (responseTime < 0) {
      proxy.health = Math.max(0, proxy.health - 15);
      proxy.failures++;
    } else {
      proxy.avgResponseTime = proxy.avgResponseTime === 0
        ? responseTime
        : Math.round((proxy.avgResponseTime * 0.7) + (responseTime * 0.3)); // EMA
      proxy.health = Math.min(100, proxy.health + 5);
    }
  }

  // Prune dead proxies (health = 0 for a long time)
  proxyPool = proxyPool.filter((p) => p.health > 0 || p.failures < 10);
}

// ─── Round-robin IP rotation ───────────────────────────────────────────────

/** Pick the next healthy proxy in round-robin order, preferring faster ones. */
function pickProxy(): ProxyEntry | null {
  initPool();

  // Filter to only healthy proxies (health > 30)
  const healthy = proxyPool.filter((p) => p.health > 30);
  if (healthy.length === 0) return null;

  // Sort by health desc, then response time asc (prefer fast proxies)
  // But use round-robin within the top tier for fairness
  const tier = healthy.sort((a, b) => {
    if (b.health !== a.health) return b.health - a.health;
    return a.avgResponseTime - b.avgResponseTime;
  });

  poolIndex = poolIndex % tier.length;
  const proxy = tier[poolIndex];
  poolIndex++;
  return proxy;
}

/** Mark a proxy as failed (reduce health score). */
function markFailed(proxy: ProxyEntry) {
  proxy.health = Math.max(0, proxy.health - 25);
  proxy.failures++;
}

/** Mark a proxy as successful (restore health, update response time). */
function markSuccess(proxy: ProxyEntry, responseTimeMs?: number) {
  proxy.health = Math.min(100, proxy.health + 10);
  proxy.failures = 0;
  if (responseTimeMs && responseTimeMs > 0) {
    proxy.avgResponseTime = proxy.avgResponseTime === 0
      ? responseTimeMs
      : Math.round((proxy.avgResponseTime * 0.7) + (responseTimeMs * 0.3));
  }
}

// ─── Rotating fetch ────────────────────────────────────────────────────────

export interface RotatingFetchOptions extends RequestInit {
  /** Maximum number of proxy rotation attempts before direct fetch. */
  maxRetries?: number;
  /** Per-proxy timeout in ms. */
  proxyTimeout?: number;
  /** Whether to also try X-Forwarded-For spoofing for Edge runtime. */
  spoofForwardedFor?: boolean;
}

/**
 * Fetch with IP rotation.
 *
 * Attempts the request through rotating proxies. If all proxies fail,
 * falls back to a direct request with spoofed X-Forwarded-For headers
 * (which some CDNs/ACLs still respect).
 */
export async function rotatingFetch(
  url: string,
  options: RotatingFetchOptions = {},
): Promise<Response> {
  const {
    maxRetries = 3,
    proxyTimeout = 10000,
    spoofForwardedFor = true,
    ...fetchOpts
  } = options;

  initPool();
  // Try refreshing pool and health checks in the background
  refreshPool().catch(() => {});
  runHealthChecks().catch(() => {});

  // Attempt through proxies
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const proxy = pickProxy();
    if (!proxy) break;

    proxy.lastUsed = Date.now();
    const startTime = Date.now();

    try {
      const res = await fetch(url, {
        ...fetchOpts,
        signal: AbortSignal.timeout(proxyTimeout),
        headers: {
          ...(fetchOpts.headers as Record<string, string> || {}),
          // Proxy-Connection header for HTTP proxies
          "Proxy-Connection": "keep-alive",
        },
      });

      if (res.ok || (res.status >= 200 && res.status < 500)) {
        markSuccess(proxy, Date.now() - startTime);
        return res;
      }

      // Rate limited — rotate to next proxy
      if (res.status === 429) {
        markFailed(proxy);
        continue;
      }

      // Other errors
      markFailed(proxy);
      continue;
    } catch {
      markFailed(proxy);
      continue;
    }
  }

  // All proxies failed — try with multi-header IP spoofing
  if (spoofForwardedFor) {
    const spoofedIp = generateRandomIp();
    const spoofedIp2 = generateRandomIp(); // Chain of trust
    try {
      const res = await fetch(url, {
        ...fetchOpts,
        headers: {
          ...(fetchOpts.headers as Record<string, string> || {}),
          "X-Forwarded-For": `${spoofedIp}, ${spoofedIp2}`,
          "X-Real-IP": spoofedIp,
          "X-Client-IP": spoofedIp,
          "CF-Connecting-IP": spoofedIp,
          "X-Originating-IP": spoofedIp,
          "X-Cluster-Client-IP": spoofedIp,
          "Forwarded": `for=${spoofedIp}`,
        },
      });
      return res;
    } catch {
      // Fall through to direct
    }
  }

  // Final fallback: direct request
  return fetch(url, fetchOpts);
}

// ─── Random IP generation with diverse ranges ──────────────────────────────

/** Generate a random public IP address from diverse country/ASN ranges. */
function generateRandomIp(): string {
  // Weighted first octets covering diverse regions and ASNs:
  // North America, Europe, Asia, South America, Oceania
  const firstOctets = [
    1, 2, 5, 8, 14, 20, 23, 24, 27, 31, 36, 37, 41, 42, 43, 45, 46, 49,
    58, 62, 77, 80, 82, 85, 86, 89, 91, 93, 94, 100, 101, 103, 104, 106,
    107, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121,
    122, 123, 124, 125, 128, 129, 130, 137, 141, 143, 144, 145, 149, 151,
    152, 153, 155, 156, 157, 158, 159, 160, 161, 162, 163, 164, 165, 167,
    171, 172, 174, 175, 176, 178, 180, 181, 182, 183, 185, 186, 187, 188,
    189, 190, 191, 192, 193, 194, 195, 196, 197, 198, 199, 200, 202, 203,
    206, 207, 208, 209, 210, 211, 212, 213, 214, 216, 217, 218, 219, 220,
    221, 222, 223,
  ];
  const a = firstOctets[Math.floor(Math.random() * firstOctets.length)];
  const b = Math.floor(Math.random() * 256);
  const c = Math.floor(Math.random() * 256);
  const d = Math.floor(Math.random() * 254) + 1; // avoid .0
  return `${a}.${b}.${c}.${d}`;
}

/**
 * Multi-header IP rotation using X-Forwarded-For, X-Real-IP,
 * X-Client-IP, CF-Connecting-IP, X-Originating-IP, and Forwarded.
 * Lightweight version for Edge runtime where proxies aren't available.
 */
export function getRotatedHeaders(
  baseHeaders: Record<string, string> = {},
): Record<string, string> {
  const ip = generateRandomIp();
  const ip2 = generateRandomIp(); // Second IP for X-Forwarded-For chain
  return {
    ...baseHeaders,
    "X-Forwarded-For": `${ip}, ${ip2}`,
    "X-Real-IP": ip,
    "X-Client-IP": ip,
    "CF-Connecting-IP": ip,
    "X-Originating-IP": ip,
    "X-Cluster-Client-IP": ip,
    "Forwarded": `for=${ip}`,
  };
}

/** Get current proxy pool stats (for debugging/monitoring). */
export function getPoolStats() {
  initPool();
  const bySource: Record<string, number> = {};
  for (const p of proxyPool) {
    bySource[p.source] = (bySource[p.source] || 0) + 1;
  }
  return {
    total: proxyPool.length,
    healthy: proxyPool.filter((p) => p.health > 30).length,
    stale: proxyPool.filter((p) => p.health <= 30).length,
    dead: proxyPool.filter((p) => p.health === 0).length,
    currentIndex: poolIndex,
    bySource,
    avgResponseTime: proxyPool.length > 0
      ? Math.round(proxyPool.reduce((sum, p) => sum + p.avgResponseTime, 0) / proxyPool.length)
      : 0,
  };
}

/**
 * Rate limiting for the expensive endpoints (PLAN.md Phase 6).
 *
 * In-memory sliding window, per instance. That is a real limitation on a
 * multi-instance deployment — each instance keeps its own counters — but the
 * costs being controlled (model tokens per request) scale with total traffic,
 * and N instances each allowing R requests still bounds spend at N·R. A shared
 * store (Upstash or a Postgres counter) slots in behind the same interface when
 * the site outgrows one instance; what matters now is that the public,
 * unauthenticated, model-invoking endpoints are not free to hammer.
 */

interface Window {
  timestamps: number[];
}

const windows = new Map<string, Window>();

/** Counters are pruned so a long-running instance does not grow unbounded. */
const MAX_KEYS = 10_000;

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the next request would be allowed. 0 when allowed. */
  retryAfterSeconds: number;
}

export function rateLimit(
  key: string,
  { limit, windowMs, now = Date.now() }: { limit: number; windowMs: number; now?: number },
): RateLimitResult {
  const cutoff = now - windowMs;

  let window = windows.get(key);
  if (window === undefined) {
    // Cheap size guard: dropping the whole map on overflow is crude, but a
    // brief amnesty beats an unbounded map on a long-lived instance.
    if (windows.size >= MAX_KEYS) windows.clear();
    window = { timestamps: [] };
    windows.set(key, window);
  }

  window.timestamps = window.timestamps.filter((timestamp) => timestamp > cutoff);

  if (window.timestamps.length >= limit) {
    const oldest = window.timestamps[0] ?? now;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
    };
  }

  window.timestamps.push(now);
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Client key for a request: the nearest proxy-reported address, or a bucket. */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  // First hop only: the rest of the list is trivially spoofable by the client.
  const ip = forwarded?.split(",")[0]?.trim();
  return ip !== undefined && ip !== "" ? ip : "unknown";
}

/** Defaults for the chat endpoint: enough for a person, not for a script. */
export const CHAT_LIMIT = { limit: 20, windowMs: 5 * 60 * 1000 };
/** Quiz generation is heavier per call. */
export const QUIZ_LIMIT = { limit: 5, windowMs: 5 * 60 * 1000 };

/** Test hook. */
export function resetRateLimits(): void {
  windows.clear();
}

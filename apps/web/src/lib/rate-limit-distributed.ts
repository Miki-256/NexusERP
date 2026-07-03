import { rateLimit as memoryRateLimit, rateLimitResponse } from "@/lib/rate-limit";

export { rateLimitResponse };

let warnedMissingUpstash = false;

function warnMissingUpstashOnce() {
  if (warnedMissingUpstash || process.env.NODE_ENV !== "production") return;
  warnedMissingUpstash = true;
  console.warn(
    "[rate-limit] UPSTASH_REDIS_REST_URL/TOKEN not set — per-instance memory limits only; configure Upstash for production."
  );
}

/** Shared rate limit via Upstash Redis when configured; otherwise in-memory fallback. */
export async function rateLimitDistributed(
  key: string,
  limit: number,
  windowMs: number
): Promise<{ ok: true } | { ok: false; retryAfterSec: number }> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    warnMissingUpstashOnce();
    return memoryRateLimit(key, limit, windowMs);
  }

  try {
    const { Ratelimit } = await import("@upstash/ratelimit");
    const { Redis } = await import("@upstash/redis");

    const windowSec = Math.max(1, Math.ceil(windowMs / 1000));
    const ratelimit = new Ratelimit({
      redis: new Redis({ url, token }),
      limiter: Ratelimit.slidingWindow(limit, `${windowSec} s`),
      prefix: "nex:rl",
    });

    const { success, reset } = await ratelimit.limit(key);
    if (success) {
      return { ok: true };
    }

    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil((reset - Date.now()) / 1000)),
    };
  } catch {
    return memoryRateLimit(key, limit, windowMs);
  }
}

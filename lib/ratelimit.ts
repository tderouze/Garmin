/**
 * Simple in-memory rate limiter (token bucket per key).
 * For V1 single-instance deployment; resets on restart.
 * Map entry: key -> timestamps[] of recent requests within window.
 */

const buckets = new Map<string, number[]>();

function getClientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  // NextRequest may have ip, fallback to anonymous bucket
  const anyReq = req as unknown as { ip?: string };
  return anyReq.ip ?? "anon";
}

export function checkRateLimit(
  req: Request,
  limit: number,
  windowMs: number
): { allowed: boolean; retryAfter?: number } {
  const key = getClientKey(req);
  const now = Date.now();
  const windowStart = now - windowMs;

  let timestamps = buckets.get(key) ?? [];
  // Cleanup expired
  timestamps = timestamps.filter((t) => t > windowStart);

  if (timestamps.length >= limit) {
    const oldest = timestamps[0] ?? now;
    const retryAfter = Math.ceil((oldest + windowMs - now) / 1000);
    // Still store cleaned list
    buckets.set(key, timestamps);
    // Opportunistic global cleanup to avoid unbounded growth
    if (buckets.size > 1000) {
      for (const [k, ts] of buckets) {
        const filtered = ts.filter((t) => t > windowStart);
        if (filtered.length === 0) buckets.delete(k);
        else buckets.set(k, filtered);
      }
    }
    return { allowed: false, retryAfter: Math.max(1, retryAfter) };
  }

  timestamps.push(now);
  buckets.set(key, timestamps);
  return { allowed: true };
}

/** For tests: clear all buckets */
export function _clearRateLimitBuckets() {
  buckets.clear();
}

/**
 * In-process sliding-window rate limiter (per Node). Replaceable later with Redis.
 */
export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();

  tryConsume(key: string, windowMs: number, max: number): { ok: true } | { ok: false; retryAfterSec: number } {
    if (max <= 0) {
      return { ok: true };
    }
    const now = Date.now();
    const cutoff = now - windowMs;
    let arr = this.hits.get(key);
    if (!arr) {
      arr = [];
      this.hits.set(key, arr);
    }
    while (arr.length > 0 && arr[0]! < cutoff) {
      arr.shift();
    }
    if (arr.length >= max) {
      const oldest = arr[0]!;
      const retryAfterMs = Math.max(0, oldest + windowMs - now);
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
    }
    arr.push(now);
    return { ok: true };
  }
}

const limiters = new Map<string, SlidingWindowRateLimiter>();

export function getSlidingWindowLimiter(name: string): SlidingWindowRateLimiter {
  let lim = limiters.get(name);
  if (!lim) {
    lim = new SlidingWindowRateLimiter();
    limiters.set(name, lim);
  }
  return lim;
}

/** Test helper: reset all in-memory limiter state. */
export function resetSlidingWindowLimitersForTests(): void {
  limiters.clear();
}

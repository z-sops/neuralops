// Token-bucket rate limiter keyed by caller (token hash or remote address).

export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>()

  constructor(
    private perSecond: number,
    private burst: number
  ) {}

  /** Returns 0 if allowed, otherwise the seconds to wait. */
  take(key: string, now = Date.now()): number {
    const b = this.buckets.get(key) ?? { tokens: this.burst, at: now }
    b.tokens = Math.min(this.burst, b.tokens + ((now - b.at) / 1000) * this.perSecond)
    b.at = now
    if (b.tokens < 1) {
      this.buckets.set(key, b)
      return Math.ceil((1 - b.tokens) / this.perSecond)
    }
    b.tokens -= 1
    this.buckets.set(key, b)
    if (this.buckets.size > 10_000) this.prune(now)
    return 0
  }

  private prune(now: number) {
    for (const [k, b] of this.buckets) if (now - b.at > 60_000) this.buckets.delete(k)
  }
}

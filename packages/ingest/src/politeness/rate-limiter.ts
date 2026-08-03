/**
 * Enforces the politeness floor of one request per 2 seconds (CLAUDE.md rule 3).
 *
 * The gap is measured from the end of one acquire() to the start of the next, so
 * a slow response never "earns" the crawler a burst afterwards.
 *
 * The clock and sleep are injectable so the behaviour can be tested without
 * actually waiting seconds per assertion.
 */
export interface RateLimiterOptions {
  minDelayMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class RateLimiter {
  readonly minDelayMs: number;
  #now: () => number;
  #sleep: (ms: number) => Promise<void>;
  #lastAt: number | null = null;
  /** Serialises callers so two concurrent acquires cannot both pass the gate. */
  #tail: Promise<void> = Promise.resolve();

  constructor({ minDelayMs, now = Date.now, sleep = defaultSleep }: RateLimiterOptions) {
    if (!Number.isFinite(minDelayMs) || minDelayMs < 0) {
      throw new RangeError(`minDelayMs must be a non-negative number, received ${minDelayMs}`);
    }
    this.minDelayMs = minDelayMs;
    this.#now = now;
    this.#sleep = sleep;
  }

  /** Resolves once it is polite to send the next request. */
  async acquire(): Promise<void> {
    const mine = this.#tail.then(() => this.#waitTurn());
    // Swallow here only to keep the chain alive; the caller still sees rejections.
    this.#tail = mine.catch(() => undefined);
    return mine;
  }

  async #waitTurn(): Promise<void> {
    if (this.#lastAt !== null) {
      const elapsed = this.#now() - this.#lastAt;
      const remaining = this.minDelayMs - elapsed;
      if (remaining > 0) await this.#sleep(remaining);
    }
    this.#lastAt = this.#now();
  }
}

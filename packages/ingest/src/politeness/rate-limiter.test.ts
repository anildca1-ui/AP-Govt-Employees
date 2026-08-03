import { describe, expect, it } from "vitest";
import { RateLimiter } from "./rate-limiter.js";

/** A controllable clock: sleeping advances time rather than actually waiting. */
function fakeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

describe("RateLimiter", () => {
  it("lets the first request through immediately", async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ minDelayMs: 2000, now: clock.now, sleep: clock.sleep });

    await limiter.acquire();

    expect(clock.now()).toBe(0);
  });

  it("holds the next request until the full delay has passed", async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ minDelayMs: 2000, now: clock.now, sleep: clock.sleep });

    await limiter.acquire();
    await limiter.acquire();

    expect(clock.now()).toBe(2000);
  });

  it("measures the gap from the previous request, not from the previous response", async () => {
    // A slow page must not earn the crawler a free burst afterwards, but time
    // already spent waiting does count towards the gap.
    const clock = fakeClock();
    const limiter = new RateLimiter({ minDelayMs: 2000, now: clock.now, sleep: clock.sleep });

    await limiter.acquire();
    clock.advance(1500); // a slow response
    await limiter.acquire();

    expect(clock.now()).toBe(2000);
  });

  it("does not sleep when the caller was already slow enough", async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ minDelayMs: 2000, now: clock.now, sleep: clock.sleep });

    await limiter.acquire();
    clock.advance(5000);
    await limiter.acquire();

    expect(clock.now()).toBe(5000);
  });

  it("serialises concurrent callers instead of letting them all through at once", async () => {
    // Without a queue, three overlapping acquires would each see the same
    // "last request" timestamp and all fire immediately.
    //
    // Asserted on the waits the limiter actually performed rather than on
    // timestamps read after each acquire resolves: the fake clock advances
    // synchronously inside sleep(), so the whole chain finishes in microtasks
    // before any `await` in the test body observes it, and reading the clock
    // afterwards measures microtask ordering instead of the gating.
    const clock = fakeClock();
    const waits: number[] = [];
    const limiter = new RateLimiter({
      minDelayMs: 2000,
      now: clock.now,
      sleep: async (ms) => {
        waits.push(ms);
        await clock.sleep(ms);
      },
    });

    await Promise.all([limiter.acquire(), limiter.acquire(), limiter.acquire()]);

    // First goes straight through; the other two each waited a full gap.
    expect(waits).toEqual([2000, 2000]);
    expect(clock.now()).toBe(4000);
  });

  it("enforces the 2s floor from CLAUDE.md rule 3 over a realistic run", async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ minDelayMs: 2000, now: clock.now, sleep: clock.sleep });

    for (let i = 0; i < 10; i++) await limiter.acquire();

    // 10 requests can never take less than 9 gaps of 2s.
    expect(clock.now()).toBe(18_000);
  });

  it("rejects a nonsensical delay rather than silently crawling flat out", () => {
    expect(() => new RateLimiter({ minDelayMs: -1 })).toThrow(RangeError);
    expect(() => new RateLimiter({ minDelayMs: Number.NaN })).toThrow(RangeError);
  });
});

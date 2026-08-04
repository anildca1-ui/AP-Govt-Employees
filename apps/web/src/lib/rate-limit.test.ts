import { beforeEach, describe, expect, it } from "vitest";
import { CHAT_LIMIT, clientKey, QUIZ_LIMIT, rateLimit, resetRateLimits } from "./rate-limit";

describe("rateLimit", () => {
  beforeEach(() => resetRateLimits());

  const options = { limit: 3, windowMs: 60_000 };

  it("allows up to the limit and then refuses", () => {
    const base = 1_000_000;

    expect(rateLimit("k", { ...options, now: base }).allowed).toBe(true);
    expect(rateLimit("k", { ...options, now: base + 1 }).allowed).toBe(true);
    expect(rateLimit("k", { ...options, now: base + 2 }).allowed).toBe(true);
    expect(rateLimit("k", { ...options, now: base + 3 }).allowed).toBe(false);
  });

  it("tells the caller when to come back", () => {
    const base = 1_000_000;
    for (let i = 0; i < 3; i++) rateLimit("k", { ...options, now: base + i });

    const refused = rateLimit("k", { ...options, now: base + 30_000 });

    expect(refused.allowed).toBe(false);
    // The oldest hit expires at base + 60s; thirty seconds remain.
    expect(refused.retryAfterSeconds).toBe(30);
  });

  it("slides: old requests age out of the window", () => {
    const base = 1_000_000;
    for (let i = 0; i < 3; i++) rateLimit("k", { ...options, now: base + i });

    expect(rateLimit("k", { ...options, now: base + 61_000 }).allowed).toBe(true);
  });

  it("keeps keys independent — one hammering client cannot exhaust another's budget", () => {
    const base = 1_000_000;
    for (let i = 0; i < 3; i++) rateLimit("attacker", { ...options, now: base + i });

    expect(rateLimit("attacker", { ...options, now: base + 4 }).allowed).toBe(false);
    expect(rateLimit("bystander", { ...options, now: base + 4 }).allowed).toBe(true);
  });

  it("has sane production defaults", () => {
    // Chat allows a person's conversation; quiz is heavier per call.
    expect(CHAT_LIMIT.limit).toBeGreaterThan(QUIZ_LIMIT.limit);
    expect(CHAT_LIMIT.windowMs).toBeGreaterThan(0);
  });
});

describe("clientKey", () => {
  it("takes the first hop of x-forwarded-for", () => {
    // Later entries are appended by proxies but the tail is client-spoofable.
    const request = new Request("https://x", {
      headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
    });

    expect(clientKey(request)).toBe("203.0.113.9");
  });

  it("buckets requests with no forwarding header rather than crashing", () => {
    expect(clientKey(new Request("https://x"))).toBe("unknown");
  });
});

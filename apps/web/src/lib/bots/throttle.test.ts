import { beforeEach, describe, expect, it } from "vitest";
import { botThrottle } from "./shared";
import { BOT_ANSWER_LIMIT, BOT_UPLOAD_LIMIT, resetRateLimits } from "@/lib/rate-limit";

/**
 * Once the webhooks authenticate their caller, the remaining abuse vector is a
 * real sender behaving badly. These cover the two decisions that make the
 * throttle useful rather than harmful: it keys on who sent the message, and it
 * stops replying to a flood instead of answering it.
 */
describe("botThrottle", () => {
  beforeEach(() => resetRateLimits());

  const base = 1_000_000;

  it("allows a normal conversation and then refuses", () => {
    for (let i = 0; i < BOT_ANSWER_LIMIT.limit; i++) {
      expect(botThrottle("whatsapp", "ask", "+919000000001", base + i).allowed).toBe(true);
    }

    expect(botThrottle("whatsapp", "ask", "+919000000001", base + 100).allowed).toBe(false);
  });

  it("keys on the sender, not the caller — one spammer must not silence everyone", () => {
    // Every webhook call arrives from Meta's or Telegram's servers. Keyed on the
    // request instead, the first flood would exhaust the budget for every user
    // of the bot at once.
    for (let i = 0; i < BOT_ANSWER_LIMIT.limit + 5; i++) {
      botThrottle("whatsapp", "ask", "+919000000001", base + i);
    }

    expect(botThrottle("whatsapp", "ask", "+919000000001", base + 200).allowed).toBe(false);
    expect(botThrottle("whatsapp", "ask", "+919000000002", base + 200).allowed).toBe(true);
  });

  it("separates the two bots", () => {
    for (let i = 0; i < BOT_ANSWER_LIMIT.limit + 1; i++) {
      botThrottle("whatsapp", "ask", "shared-id", base + i);
    }

    expect(botThrottle("whatsapp", "ask", "shared-id", base + 300).allowed).toBe(false);
    expect(botThrottle("telegram", "ask", "shared-id", base + 300).allowed).toBe(true);
  });

  it("budgets uploads separately from questions", () => {
    // Forwarding GOs must not be blocked by having asked a lot of questions,
    // and vice versa — they cost different things.
    for (let i = 0; i < BOT_ANSWER_LIMIT.limit + 1; i++) {
      botThrottle("telegram", "ask", "42", base + i);
    }

    expect(botThrottle("telegram", "ask", "42", base + 400).allowed).toBe(false);
    expect(botThrottle("telegram", "upload", "42", base + 400).allowed).toBe(true);
  });

  it("lets a contributor forward a real batch before refusing", () => {
    for (let i = 0; i < BOT_UPLOAD_LIMIT.limit; i++) {
      expect(botThrottle("telegram", "upload", "42", base + i).allowed).toBe(true);
    }

    expect(botThrottle("telegram", "upload", "42", base + 500).allowed).toBe(false);
  });

  it("says why once, then goes quiet rather than answering a flood", () => {
    for (let i = 0; i < BOT_ANSWER_LIMIT.limit; i++) {
      botThrottle("whatsapp", "ask", "+919000000003", base + i);
    }

    const first = botThrottle("whatsapp", "ask", "+919000000003", base + 600);
    expect(first.allowed).toBe(false);
    expect(first.notice).toMatch(/try again/i);
    // Bilingual: the reader is a Telugu-speaking employee wondering why the bot
    // stopped.
    expect(first.notice).toMatch(/[ఀ-౿]/);

    // Replying to every refused message would make our own number the
    // amplifier — a thousand messages in, a thousand paid replies out.
    for (const offset of [601, 602, 900]) {
      expect(botThrottle("whatsapp", "ask", "+919000000003", base + offset).notice).toBeNull();
    }
  });

  it("recovers once the window slides", () => {
    for (let i = 0; i < BOT_ANSWER_LIMIT.limit; i++) {
      botThrottle("whatsapp", "ask", "+919000000004", base + i);
    }
    expect(botThrottle("whatsapp", "ask", "+919000000004", base + 700).allowed).toBe(false);

    const later = base + BOT_ANSWER_LIMIT.windowMs + 1_000;
    expect(botThrottle("whatsapp", "ask", "+919000000004", later).allowed).toBe(true);
  });
});

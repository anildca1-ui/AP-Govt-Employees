import { describe, expect, it } from "vitest";
import {
  classifyFailure,
  failureMessage,
  FALLBACK_RETRY_SECONDS,
  formatWait,
  MAX_QUESTION_CHARS,
} from "./failure";
import { getDictionary } from "@/i18n/dictionary";
import { locales } from "@/i18n/config";

const te = getDictionary("te");
const en = getDictionary("en");

describe("classifyFailure", () => {
  it("reads the wait from Retry-After on a 429", () => {
    expect(classifyFailure(429, "45")).toEqual({ kind: "rate-limited", retryAfterSeconds: 45 });
  });

  it.each([null, "", "soon", "-10", "0", "NaN"])(
    "falls back to the window when Retry-After is %j",
    (header) => {
      expect(classifyFailure(429, header)).toEqual({
        kind: "rate-limited",
        retryAfterSeconds: FALLBACK_RETRY_SECONDS,
      });
    },
  );

  it("rounds a fractional wait up, never down", () => {
    // Advising a retry sooner than the limiter allows just earns a second 429.
    expect(classifyFailure(429, "30.2")).toEqual({ kind: "rate-limited", retryAfterSeconds: 31 });
  });

  it.each([400, 401, 404, 500, 502, 503])("treats %i as generic", (status) => {
    expect(classifyFailure(status, null)).toEqual({ kind: "generic" });
  });
});

describe("formatWait", () => {
  it("uses seconds below a minute", () => {
    expect(formatWait(45, en)).toBe("45 seconds");
  });

  it("uses whole minutes at or above one, rounding up", () => {
    expect(formatWait(60, en)).toBe("1 minutes");
    expect(formatWait(300, en)).toBe("5 minutes");
    expect(formatWait(61, en)).toBe("2 minutes");
  });

  it("substitutes into the Telugu string too", () => {
    expect(formatWait(30, te)).toBe("30 సెకన్ల");
    expect(formatWait(300, te)).toBe("5 నిమిషాల");
  });
});

describe("failureMessage", () => {
  it("names the wait in the rate-limited message", () => {
    const message = failureMessage({ kind: "rate-limited", retryAfterSeconds: 300 }, en);
    expect(message).toContain("5 minutes");
    expect(message).not.toContain("{wait}");
  });

  it("uses the generic message otherwise", () => {
    expect(failureMessage({ kind: "generic" }, te)).toBe(te.chat.error);
  });

  /**
   * The defect this module exists for: a missing environment variable was
   * rendered in the answer bubble, so an employee asking about their DA read
   * "NEXT_PUBLIC_SUPABASE_URL is not set" as the answer. Nothing the server
   * says may reach the reader — only the status code selects the message.
   */
  it("never surfaces server prose, whatever the server said", () => {
    const leaks = [
      "NEXT_PUBLIC_SUPABASE_URL is not set",
      "GEMINI_API_KEY is not set",
      "Too many requests",
      "Question is longer than 2000 characters",
      "fetch failed",
    ];
    for (const status of [400, 429, 500, 503]) {
      const rendered = failureMessage(classifyFailure(status, "60"), te);
      for (const leak of leaks) expect(rendered).not.toContain(leak);
    }
  });

  it.each(locales)("renders no placeholder or untranslated text in %s", (locale) => {
    const dict = getDictionary(locale);
    for (const failure of [
      { kind: "generic" } as const,
      { kind: "rate-limited" as const, retryAfterSeconds: 30 },
      { kind: "rate-limited" as const, retryAfterSeconds: 300 },
    ]) {
      const message = failureMessage(failure, dict);
      expect(message).not.toMatch(/\{\w+\}/);
      expect(message.trim()).not.toBe("");
      // Telugu must not fall back to an untranslated English sentence.
      if (locale === "te") expect(message).toMatch(/[ఀ-౿]/);
    }
  });
});

describe("MAX_QUESTION_CHARS", () => {
  it("matches the limit the server enforces", async () => {
    const service = await import("./service");
    expect(MAX_QUESTION_CHARS).toBe(service.MAX_QUESTION_CHARS);
  });
});

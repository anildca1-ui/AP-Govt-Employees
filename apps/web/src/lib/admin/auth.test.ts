import { describe, expect, it } from "vitest";
import { tokenMatches } from "./auth";

describe("tokenMatches", () => {
  it("accepts the exact configured token", () => {
    expect(tokenMatches("s3cret-token", "s3cret-token")).toBe(true);
  });

  it("rejects a wrong token of the same length", () => {
    expect(tokenMatches("s3cret-tokeN", "s3cret-token")).toBe(false);
  });

  it("always denies when the env token is unset or empty", () => {
    // "Nobody configured a token" must close admin, not open it to "".
    expect(tokenMatches("anything", undefined)).toBe(false);
    expect(tokenMatches("anything", "")).toBe(false);
    expect(tokenMatches("", "")).toBe(false);
    expect(tokenMatches(undefined, undefined)).toBe(false);
  });

  it("denies a missing candidate against a configured token", () => {
    expect(tokenMatches(undefined, "s3cret-token")).toBe(false);
    expect(tokenMatches("", "s3cret-token")).toBe(false);
  });

  it("handles a length mismatch as a plain deny, not a crash", () => {
    // Unguarded timingSafeEqual throws on unequal buffer lengths, which would
    // turn every typo into a 500 instead of a failed login.
    expect(() => tokenMatches("short", "much-longer-token")).not.toThrow();
    expect(tokenMatches("short", "much-longer-token")).toBe(false);
  });

  it("compares bytes, not code points, so multibyte tokens work", () => {
    expect(tokenMatches("టోకెన్", "టోకెన్")).toBe(true);
    expect(tokenMatches("టోకెన", "టోకెన్")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { ACCOUNT_ERROR_CODES, accountErrorMessage } from "./errors";
import { validateProfile } from "./profile";
import { getDictionary } from "@/i18n/dictionary";
import { locales } from "@/i18n/config";

describe("accountErrorMessage", () => {
  it("returns nothing when there is no error", () => {
    expect(accountErrorMessage(undefined, getDictionary("te"))).toBeNull();
  });

  it.each(locales)("translates every known code in %s", (locale) => {
    const dict = getDictionary(locale);
    const seen = new Set<string>();
    for (const code of ACCOUNT_ERROR_CODES) {
      const message = accountErrorMessage(code, dict);
      expect(message, code).toBeTruthy();
      expect(message, code).not.toBe(code);
      if (locale === "te") expect(message, code).toMatch(/[ఀ-౿]/);
      seen.add(message!);
    }
    // Distinct codes must not collapse onto one string, or a reader is told
    // "something went wrong" for a problem the page could name.
    expect(seen.size).toBe(ACCOUNT_ERROR_CODES.length);
  });

  it("falls back to the generic message for an unknown code", () => {
    const dict = getDictionary("te");
    expect(accountErrorMessage("newCodeNobodyMapped", dict)).toBe(dict.account.errGeneric);
  });

  /**
   * The defect: ?error= carried prose straight to the page — a validation
   * message written for a developer, or Postgres describing our schema.
   */
  it("never echoes prose that arrives in the parameter", () => {
    const dict = getDictionary("te");
    const leaks = [
      "Basic pay must be a positive number",
      'new row violates row-level security policy for table "users"',
      "duplicate key value violates unique constraint",
      "<script>alert(1)</script>",
    ];
    for (const leak of leaks) {
      const rendered = accountErrorMessage(leak, dict);
      expect(rendered).toBe(dict.account.errGeneric);
      expect(rendered).not.toContain(leak);
    }
  });
});

describe("validateProfile problem codes", () => {
  it.each([
    [{ basicPay: "0" }, "basicPayInvalid"],
    [{ basicPay: "abc" }, "basicPayInvalid"],
    [{ basicPay: "99999999" }, "basicPayTypo"],
    [{ joinDate: "not-a-date" }, "joinDateInvalid"],
    [{ scheme: "MADE_UP" }, "schemeUnknown"],
  ])("reports %j as %s", (input, code) => {
    const { problems } = validateProfile(input);
    expect(problems[0]?.code).toBe(code);
  });

  it("gives every problem a code the page can translate", () => {
    // A problem with no mapping would reach the reader as the generic message,
    // losing the one thing that would tell them what to fix.
    const dict = getDictionary("te");
    for (const input of [
      { basicPay: "0" },
      { basicPay: "99999999" },
      { joinDate: "13-13-13" },
      { scheme: "X" },
    ]) {
      const { problems } = validateProfile(input);
      expect(problems.length).toBeGreaterThan(0);
      for (const problem of problems) {
        expect(ACCOUNT_ERROR_CODES).toContain(problem.code);
        expect(accountErrorMessage(problem.code, dict)).not.toBe(dict.account.errGeneric);
      }
    }
  });
});

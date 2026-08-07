import { describe, expect, it } from "vitest";
import {
  calculateDaArrears,
  monthsBetween,
  rateOn,
  nextStage,
  type RateRow,
} from "@ap-emp-ai/calc";
import { calcErrorMessage } from "./errors";
import { getDictionary } from "@/i18n/dictionary";
import { locales } from "@/i18n/config";

const te = getDictionary("te");
const en = getDictionary("en");

/** Every phrase that is addressed to whoever runs the site, not to a reader. */
const MAINTAINER_WORDS =
  /seed or verify|seed or extend|CLAUDE\.md|rates table|rule 1|received |cashFraction/;

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected the calculator to refuse, but it returned");
}

describe("calcErrorMessage", () => {
  it("keeps the particulars of a missing rate without the instructions", () => {
    // The defect: this rendered "…Rates come from the rates table (CLAUDE.md
    // rule 1); seed or verify the row before calculating." on the DA page.
    const error = thrown(() => rateOn([] as RateRow<unknown>[], "DA", "2017-01-01"));

    const message = calcErrorMessage(error, te);
    expect(message).toContain("2017-01-01");
    expect(message).not.toMatch(MAINTAINER_WORDS);
    expect(message).toMatch(/[ఀ-౿]/);
  });

  it("names the pay that is off the scale", () => {
    const error = thrown(() => nextStage([20000, 20600], 20301));

    const message = calcErrorMessage(error, en);
    expect(message).toContain("20301");
    expect(message).not.toMatch(MAINTAINER_WORDS);
  });

  it("says which way round the period should be", () => {
    const error = thrown(() => monthsBetween("2025-06", "2024-01"));

    const message = calcErrorMessage(error, en);
    expect(message).toContain("2025-06");
    expect(message).toContain("2024-01");
  });

  it("names the month that could not be read", () => {
    const error = thrown(() => monthsBetween("not-a-month", "2024-01"));

    expect(calcErrorMessage(error, en)).toContain("not-a-month");
  });

  it("uses the general message for a guard the form should have caught", () => {
    // "cashFraction must be between 0 and 1" names an internal parameter.
    const error = thrown(() =>
      calculateDaArrears(
        { basicPay: -1, fromMonth: "2024-01", toMonth: "2024-02", paidDaPercent: 0 },
        [] as RateRow<{ percent: number }>[],
      ),
    );

    expect(calcErrorMessage(error, te)).toBe(te.calculators.errors.generic);
  });

  it("uses the general message for anything that is not a calculator error", () => {
    for (const value of [new TypeError("x.y is not a function"), "boom", null, undefined]) {
      expect(calcErrorMessage(value, te)).toBe(te.calculators.errors.generic);
    }
  });

  it.each(locales)("leaves no unfilled placeholder in %s", (locale) => {
    const dict = getDictionary(locale);
    const cases = [
      () => rateOn([] as RateRow<unknown>[], "DA", "2017-01-01"),
      () => nextStage([20000, 20600], 20301),
      () => monthsBetween("2025-06", "2024-01"),
      () => monthsBetween("nope", "2024-01"),
    ];
    for (const fn of cases) {
      const message = calcErrorMessage(thrown(fn), dict);
      expect(message).not.toMatch(/\{\w+\}/);
      expect(message).not.toMatch(MAINTAINER_WORDS);
      if (locale === "te") expect(message).toMatch(/[ఀ-౿]/);
    }
  });
});

import { describe, expect, it } from "vitest";
import { calculateDaArrears, InvalidPeriodError, monthsBetween } from "./da-arrears.js";
import type { RateRow } from "./rates.js";

/** Two DA periods, matching the real 33.67% → 37.31% revision. */
const RATES: RateRow<{ percent: number }>[] = [
  {
    kind: "DA",
    effective_from: "2023-07-01",
    effective_to: "2023-12-31",
    payload: {
      percent: 33.67,
      _source_go: { go_number: "G.O.Ms.No.30", go_date: null, verified: false },
      _unverified: true,
    },
  },
  {
    kind: "DA",
    effective_from: "2024-01-01",
    effective_to: null,
    payload: {
      percent: 37.31,
      _source_go: { go_number: "G.O.Ms.No.60", go_date: "2025-10-20", verified: false },
      _unverified: true,
    },
  },
];

describe("monthsBetween", () => {
  it("is inclusive of both endpoints", () => {
    expect(monthsBetween("2024-01", "2024-03")).toEqual(["2024-01", "2024-02", "2024-03"]);
  });

  it("handles a single month", () => {
    expect(monthsBetween("2024-05", "2024-05")).toEqual(["2024-05"]);
  });

  it("crosses a year boundary", () => {
    expect(monthsBetween("2023-11", "2024-02")).toEqual([
      "2023-11",
      "2023-12",
      "2024-01",
      "2024-02",
    ]);
  });

  it("counts 21 months across two year boundaries", () => {
    // The real G.O.Ms.No.60 window: 01.01.2024 to 30.09.2025.
    expect(monthsBetween("2024-01", "2025-09")).toHaveLength(21);
  });

  it("rejects a reversed or malformed period rather than returning []", () => {
    expect(() => monthsBetween("2024-03", "2024-01")).toThrow(InvalidPeriodError);
    expect(() => monthsBetween("2024-13", "2024-14")).toThrow(InvalidPeriodError);
    expect(() => monthsBetween("2024-1", "2024-03")).toThrow(InvalidPeriodError);
    expect(() => monthsBetween("", "2024-03")).toThrow(InvalidPeriodError);
  });
});

describe("calculateDaArrears", () => {
  it("computes the worked example month by month", () => {
    // Basic 52,590; paid at 33.67%, due 37.31% from Jan-2024. Difference is
    // 3.64% of basic = 1,914.28 → 1,914/month, over three months.
    const result = calculateDaArrears(
      { basicPay: 52590, fromMonth: "2024-01", toMonth: "2024-03", paidDaPercent: 33.67 },
      RATES,
    );

    expect(result.months).toHaveLength(3);
    expect(result.months[0]).toMatchObject({
      month: "2024-01",
      paidDaPercent: 33.67,
      dueDaPercent: 37.31,
      paidDa: 17707, // 52590 * 33.67% = 17,706.9
      dueDa: 19621, // 52590 * 37.31% = 19,621.3
      difference: 1914,
      sourceGo: "G.O.Ms.No.60",
    });
    expect(result.total).toBe(5742);
  });

  it("applies whichever rate was in force in each month, not one flat rate", () => {
    // Dec-2023 is still 33.67% (nothing owed); Jan-2024 onward is 37.31%.
    const result = calculateDaArrears(
      { basicPay: 52590, fromMonth: "2023-12", toMonth: "2024-01", paidDaPercent: 33.67 },
      RATES,
    );

    expect(result.months[0]?.difference).toBe(0);
    expect(result.months[1]?.difference).toBe(1914);
    expect(result.total).toBe(1914);
  });

  it("takes the difference between two whole-rupee bill lines, not of the percentages", () => {
    // PLAN.md Part 4 writes the arrear as basic × (newDA − oldDA) / 100. That
    // is a good shorthand and it is not what an employee is owed.
    //
    // DA appears on a pay bill as a whole-rupee figure. The arrear is the gap
    // between what the bill should have said and what it did say, so both
    // sides are rounded before they are subtracted. Rounding the difference of
    // the percentages instead gives a different answer for about a quarter of
    // the stages on the master scale.
    //
    // At basic 21,200, paid 30.03%, due 37.31%:
    //   due  round(7,909.720) = 7,910
    //   paid round(6,366.360) = 6,366   → 1,544
    //   shorthand round(1,543.360)      = 1,543
    //
    // The other worked examples here happen to agree under both rules, so
    // without this case a rewrite to the shorthand would pass the whole suite
    // and quietly change what the site tells people they are owed.
    const result = calculateDaArrears(
      { basicPay: 21200, fromMonth: "2024-01", toMonth: "2024-01", paidDaPercent: 30.03 },
      RATES,
    );

    expect(result.months[0]).toMatchObject({ paidDa: 6366, dueDa: 7910, difference: 1544 });
    expect(result.total).toBe(1544);
    expect(result.total).not.toBe(1543);
  });

  it("splits cash and GPF/CPS exactly, with no rupee lost to rounding", () => {
    // The sanctioning GO decides the split, so it is an input. The two parts
    // must add back to the total exactly — a stray rupee in a pay bill costs
    // someone an afternoon at the treasury.
    const result = calculateDaArrears(
      {
        basicPay: 52590,
        fromMonth: "2024-01",
        toMonth: "2024-03",
        paidDaPercent: 33.67,
        cashFraction: 0.1,
      },
      RATES,
    );

    expect(result.cash + result.gpfOrCps).toBe(result.total);
    expect(result.cash).toBe(574); // 5742 * 0.1 = 574.2
    expect(result.gpfOrCps).toBe(5168);
  });

  it("defaults to paying the whole arrear in cash", () => {
    const result = calculateDaArrears(
      { basicPay: 52590, fromMonth: "2024-01", toMonth: "2024-01", paidDaPercent: 33.67 },
      RATES,
    );

    expect(result.cash).toBe(result.total);
    expect(result.gpfOrCps).toBe(0);
  });

  it("reports zero when the employee was already paid the due rate", () => {
    const result = calculateDaArrears(
      { basicPay: 52590, fromMonth: "2024-01", toMonth: "2024-06", paidDaPercent: 37.31 },
      RATES,
    );

    expect(result.total).toBe(0);
  });

  it("carries the source GOs and the unverified flag through to the result", () => {
    // Rule 1: the page must be able to say which GO the figure came from, and
    // must not present an unchecked rate as authoritative.
    const result = calculateDaArrears(
      { basicPay: 52590, fromMonth: "2023-12", toMonth: "2024-01", paidDaPercent: 33.67 },
      RATES,
    );

    expect(result.sourceGos).toEqual(["G.O.Ms.No.30", "G.O.Ms.No.60"]);
    expect(result.unverified).toBe(true);
  });

  it("refuses a period with no rate on record rather than guessing", () => {
    expect(() =>
      calculateDaArrears(
        { basicPay: 52590, fromMonth: "2019-01", toMonth: "2019-03", paidDaPercent: 20 },
        RATES,
      ),
    ).toThrow(/No DA rate is on record/);
  });

  it("rejects nonsensical inputs", () => {
    const base = { fromMonth: "2024-01", toMonth: "2024-03", paidDaPercent: 33.67 };

    expect(() => calculateDaArrears({ ...base, basicPay: 0 }, RATES)).toThrow(InvalidPeriodError);
    expect(() => calculateDaArrears({ ...base, basicPay: -100 }, RATES)).toThrow(InvalidPeriodError);
    expect(() => calculateDaArrears({ ...base, basicPay: Number.NaN }, RATES)).toThrow(
      InvalidPeriodError,
    );
    expect(() => calculateDaArrears({ ...base, basicPay: 52590, cashFraction: 1.5 }, RATES)).toThrow(
      InvalidPeriodError,
    );
  });

  it("handles a recovery when the paid rate was higher than the due rate", () => {
    // Rare but real: an overpayment recovered after a revision is corrected.
    const result = calculateDaArrears(
      { basicPay: 52590, fromMonth: "2023-07", toMonth: "2023-08", paidDaPercent: 37.31 },
      RATES,
    );

    expect(result.total).toBeLessThan(0);
    expect(result.months[0]?.difference).toBe(-1914);
  });
});

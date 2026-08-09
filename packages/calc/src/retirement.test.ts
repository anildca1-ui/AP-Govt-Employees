import { describe, expect, it } from "vitest";
import {
  calculateGpf,
  calculateGratuity,
  calculateLeaveEncashment,
  calculateOpsPension,
  calculateRetirement,
  estimateGps,
  InvalidInputError,
  projectNps,
} from "./retirement.js";

describe("projectNps", () => {
  const base = {
    basicPay: 52590,
    daPercent: 37.31,
    employeePercent: 10,
    governmentPercent: 14,
    yearsToRetirement: 20,
    annualReturnPercent: 8,
  };

  it("computes the monthly contribution on basic + DA", () => {
    // 52,590 × 1.3731 = 72,211.3 emoluments; 10% and 14% of that.
    const result = projectNps(base);

    expect(result.monthlyEmployee).toBe(7221);
    expect(result.monthlyGovernment).toBe(10110);
    expect(result.monthlyTotal).toBe(17331);
  });

  it("grows the corpus beyond what was contributed", () => {
    const result = projectNps(base);

    expect(result.totalContributed).toBeGreaterThan(0);
    expect(result.projectedCorpus).toBeGreaterThan(result.totalContributed);
    expect(result.growth).toBe(result.projectedCorpus - result.totalContributed);
  });

  it("compounds: doubling the years more than doubles the corpus", () => {
    const ten = projectNps({ ...base, yearsToRetirement: 10 });
    const twenty = projectNps({ ...base, yearsToRetirement: 20 });

    expect(twenty.projectedCorpus).toBeGreaterThan(ten.projectedCorpus * 2);
  });

  it("contributes nothing with no return and no time", () => {
    const result = projectNps({ ...base, yearsToRetirement: 0 });
    expect(result.projectedCorpus).toBe(0);
  });

  it("raises contributions each year when pay grows", () => {
    const flat = projectNps(base);
    const growing = projectNps({ ...base, annualIncrementPercent: 3 });

    expect(growing.totalContributed).toBeGreaterThan(flat.totalContributed);
  });

  it("rejects nonsense input", () => {
    expect(() => projectNps({ ...base, basicPay: -1 })).toThrow(InvalidInputError);
    expect(() => projectNps({ ...base, yearsToRetirement: Number.NaN })).toThrow(InvalidInputError);
  });
});

describe("estimateGps", () => {
  it("assures the stated fraction of last basic", () => {
    expect(estimateGps({ lastBasicPay: 100000, assuredPercent: 50 }).assuredMonthlyPension).toBe(
      50000,
    );
  });

  it("compares against a CPS annuity when a corpus is supplied", () => {
    // 60 lakh at 6% = 30,000/month, against 50,000 assured.
    const result = estimateGps({
      lastBasicPay: 100000,
      assuredPercent: 50,
      cpsCorpus: 6_000_000,
      annuityRatePercent: 6,
    });

    expect(result.cpsMonthlyPension).toBe(30000);
    expect(result.difference).toBe(20000);
  });

  it("omits the comparison when there is no corpus to compare", () => {
    const result = estimateGps({ lastBasicPay: 100000, assuredPercent: 50 });

    expect(result.cpsMonthlyPension).toBeNull();
    expect(result.difference).toBeNull();
  });

  it("always marks itself an estimate", () => {
    // PLAN.md Part 4 requires this to be labelled clearly.
    expect(estimateGps({ lastBasicPay: 1, assuredPercent: 50 }).isEstimate).toBe(true);
  });
});

describe("calculateOpsPension", () => {
  const base = { lastPay: 100000, fullPensionYears: 20, pensionPercent: 50 };

  it("pays half of last pay at full qualifying service", () => {
    const result = calculateOpsPension({ ...base, qualifyingYears: 25 });

    expect(result.monthlyPension).toBe(50000);
    expect(result.proRated).toBe(false);
  });

  it("pro-rates short service", () => {
    // 10 of 20 years earns half the full pension.
    const result = calculateOpsPension({ ...base, qualifyingYears: 10 });

    expect(result.monthlyPension).toBe(25000);
    expect(result.proRated).toBe(true);
  });

  it("does not pay more than full for longer service", () => {
    expect(calculateOpsPension({ ...base, qualifyingYears: 40 }).monthlyPension).toBe(50000);
  });

  it("computes commutation as portion × factor × 12", () => {
    // 40% of 50,000 = 20,000 commuted; × 9.81 × 12 = 23,54,400.
    const result = calculateOpsPension({
      ...base,
      qualifyingYears: 25,
      maxCommutationPercent: 40,
      commutationFactor: 9.81,
    });

    expect(result.commutedPortion).toBe(20000);
    expect(result.commutedLumpSum).toBe(2_354_400);
    expect(result.residualPension).toBe(30000);
  });

  it("omits commutation when no factor is supplied", () => {
    // The factor is age-based and comes from the GO's table; guessing one
    // would produce a confident, wrong lump sum.
    const result = calculateOpsPension({ ...base, qualifyingYears: 25 });

    expect(result.commutedLumpSum).toBeNull();
  });
});

describe("calculateGratuity", () => {
  const base = { lastBasicPay: 100000, daPercent: 37.31, qualifyingYears: 33 };

  it("computes on basic + DA, not basic alone", () => {
    const result = calculateGratuity(base);

    expect(result.emoluments).toBe(137310);
  });

  it("earns half a month's emoluments per year of service", () => {
    // 33 years → 33 half-months = 16.5 months.
    const result = calculateGratuity(base);

    expect(result.halfMonthsEarned).toBe(33);
    expect(result.computed).toBe(Math.round((137310 / 2) * 33));
  });

  it("keeps emoluments exact, so the page's arithmetic checks out", () => {
    // base uses a basic pay of 100,000, whose emoluments land on a whole
    // rupee, so neither case above could tell a rounded figure from an exact
    // one. 52,590 × 1.3731 = 72,211.329 can: rounding it for display left
    // "₹72,211 / 2 × 33" ₹5.50 short of the total shown beside it.
    const result = calculateGratuity({ ...base, lastBasicPay: 52590 });

    expect(result.emoluments).toBeCloseTo(72211.329, 3);
    expect(result.emoluments).not.toBe(72211);
    expect(Math.round((result.emoluments / 2) * result.halfMonthsEarned)).toBe(result.computed);
  });

  it("caps service at the maximum half-months", () => {
    const result = calculateGratuity({ ...base, qualifyingYears: 40 });

    expect(result.halfMonthsEarned).toBe(33);
    expect(result.cappedByMaxService).toBe(true);
  });

  it("applies the rupee ceiling when one is on record", () => {
    const result = calculateGratuity({ ...base, ceiling: 1_600_000 });

    expect(result.payable).toBe(1_600_000);
    expect(result.cappedByCeiling).toBe(true);
    expect(result.computed).toBeGreaterThan(result.payable);
  });

  it("does not cap when the computed amount is under the ceiling", () => {
    const result = calculateGratuity({ ...base, qualifyingYears: 10, ceiling: 1_600_000 });

    expect(result.cappedByCeiling).toBe(false);
    expect(result.payable).toBe(result.computed);
  });
});

describe("calculateLeaveEncashment", () => {
  const base = { basicPay: 100000, daPercent: 37.31 };

  it("values a day at (basic + DA) / 30", () => {
    // 137,310 / 30 = 4,577.
    const result = calculateLeaveEncashment({ ...base, days: 300 });

    expect(result.perDay).toBe(4577);
    expect(result.amount).toBe(roundish(137310 / 30, 300));
  });

  it("keeps the daily rate exact, so the page's arithmetic checks out", () => {
    // The case above uses a basic pay whose daily rate lands on a whole rupee,
    // so it could not tell a rounded rate from an exact one. This one can.
    //
    // 52,590 × 1.3731 = 72,211.329 → 2,407.0443 a day. Rounding that for
    // display put "₹2,407 × 300 days" ₹13 below the total on the same screen,
    // which someone checking their retirement payout would have to reconcile.
    const result = calculateLeaveEncashment({ basicPay: 52590, daPercent: 37.31, days: 300 });

    expect(result.perDay).toBeCloseTo(2407.0443, 4);
    expect(result.perDay).not.toBe(2407);
    expect(result.amount).toBe(722113);

    // What the page shows is emoluments, because that is what a reader can
    // multiply back: (72,211.33 / 30) × 300 lands on the total, while the
    // per-day rate at two decimals is a rupee out over 300 days.
    expect(result.emoluments).toBeCloseTo(72211.329, 3);
    const asShown = Number(result.emoluments.toFixed(2));
    expect(Math.round((asShown / 30) * result.daysPaid)).toBe(result.amount);
  });

  it("caps at the maximum encashable days", () => {
    const result = calculateLeaveEncashment({ ...base, days: 400, maxDays: 300 });

    expect(result.daysPaid).toBe(300);
    expect(result.capped).toBe(true);
  });

  it("does not cap below the maximum", () => {
    const result = calculateLeaveEncashment({ ...base, days: 120, maxDays: 300 });

    expect(result.daysPaid).toBe(120);
    expect(result.capped).toBe(false);
  });

  it("handles surrender leave of 15 or 30 days", () => {
    expect(calculateLeaveEncashment({ ...base, days: 15 }).daysPaid).toBe(15);
    expect(calculateLeaveEncashment({ ...base, days: 30 }).daysPaid).toBe(30);
  });
});

function roundish(perDay: number, days: number): number {
  return Math.round(perDay * days);
}

describe("calculateGpf", () => {
  it("accrues interest on the running monthly balance, not the closing one", () => {
    // Applying 7.1% to the closing balance would overstate the interest, since
    // a subscription paid in month 12 has not been on deposit for a year.
    const result = calculateGpf({
      openingBalance: 500000,
      monthlySubscription: 10000,
      annualRatePercent: 7.1,
    });

    const naive = (500000 + 120000) * 0.071;
    expect(result.interest).toBeLessThan(naive);
    expect(result.interest).toBeGreaterThan(500000 * 0.071);
  });

  it("adds up: opening + subscribed + interest = closing", () => {
    const result = calculateGpf({
      openingBalance: 500000,
      monthlySubscription: 10000,
      annualRatePercent: 7.1,
    });

    expect(result.closingBalance).toBe(
      result.openingBalance + result.totalSubscribed + result.interest,
    );
  });

  it("earns nothing at a zero rate", () => {
    const result = calculateGpf({
      openingBalance: 100000,
      monthlySubscription: 1000,
      annualRatePercent: 0,
    });

    expect(result.interest).toBe(0);
  });
});

describe("calculateRetirement", () => {
  it("retires on the last day of the month the age is attained", () => {
    // Born 15 June 1970, retiring at 60: the last day of June 2030, not the
    // birthday. Someone born on the 2nd serves nearly a whole extra month.
    const result = calculateRetirement({
      dateOfBirth: "1970-06-15",
      dateOfJoining: "1995-08-01",
      retirementAge: 60,
      asOf: "2026-08-03",
    });

    expect(result.retirementDate).toBe("2030-06-30");
  });

  it("gets the last day right in February, including a leap year", () => {
    expect(
      calculateRetirement({
        dateOfBirth: "1964-02-10",
        dateOfJoining: "1990-01-01",
        retirementAge: 60,
        asOf: "2026-08-03",
      }).retirementDate,
    ).toBe("2024-02-29");

    expect(
      calculateRetirement({
        dateOfBirth: "1965-02-10",
        dateOfJoining: "1990-01-01",
        retirementAge: 60,
        asOf: "2026-08-03",
      }).retirementDate,
    ).toBe("2025-02-28");
  });

  it("reports service length and days remaining", () => {
    const result = calculateRetirement({
      dateOfBirth: "1970-06-15",
      dateOfJoining: "1995-08-01",
      retirementAge: 60,
      asOf: "2026-08-03",
    });

    expect(result.totalServiceYears).toBeGreaterThan(34);
    expect(result.completedServiceYears).toBeGreaterThan(30);
    expect(result.remainingDays).toBeGreaterThan(1400);
    expect(result.alreadyRetired).toBe(false);
  });

  it("recognises someone already retired", () => {
    const result = calculateRetirement({
      dateOfBirth: "1960-01-10",
      dateOfJoining: "1985-01-01",
      retirementAge: 60,
      asOf: "2026-08-03",
    });

    expect(result.alreadyRetired).toBe(true);
    expect(result.remainingDays).toBe(0);
  });

  it("rejects impossible or malformed dates", () => {
    expect(() =>
      calculateRetirement({
        dateOfBirth: "1970-06-15",
        dateOfJoining: "1960-01-01",
        retirementAge: 60,
      }),
    ).toThrow(InvalidInputError);

    expect(() =>
      calculateRetirement({ dateOfBirth: "15-06-1970", dateOfJoining: "1995-08-01", retirementAge: 60 }),
    ).toThrow(InvalidInputError);
  });
});

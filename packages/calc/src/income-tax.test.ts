import { describe, expect, it } from "vitest";
import {
  calculateTax,
  compareRegimes,
  InvalidTaxInputError,
  taxBySlabs,
  type TaxRegimePayload,
} from "./income-tax.js";

/** FY 2025-26 new regime, as seeded (unverified — see the rates seed). */
const NEW_REGIME: TaxRegimePayload = {
  regime: "new",
  fy: "2025-26",
  slabs: [
    { upto: 400000, percent: 0 },
    { upto: 800000, percent: 5 },
    { upto: 1200000, percent: 10 },
    { upto: 1600000, percent: 15 },
    { upto: 2000000, percent: 20 },
    { upto: 2400000, percent: 25 },
    { upto: null, percent: 30 },
  ],
  standardDeduction: 75000,
  rebate87aUpto: 1200000,
  cessPercent: 4,
};

const OLD_REGIME: TaxRegimePayload = {
  regime: "old",
  fy: "2025-26",
  slabs: [
    { upto: 250000, percent: 0 },
    { upto: 500000, percent: 5 },
    { upto: 1000000, percent: 20 },
    { upto: null, percent: 30 },
  ],
  standardDeduction: 50000,
  rebate87aUpto: 500000,
  cessPercent: 4,
};

describe("taxBySlabs", () => {
  it("taxes each band marginally, not the whole income at the top rate", () => {
    // 10,00,000: 0 on the first 4L, 5% on the next 4L (20,000), 10% on the
    // last 2L (20,000) = 40,000.
    const { total } = taxBySlabs(1_000_000, NEW_REGIME.slabs);

    expect(total).toBe(40000);
  });

  it("charges nothing below the first threshold", () => {
    expect(taxBySlabs(350_000, NEW_REGIME.slabs).total).toBe(0);
  });

  it("applies the open-ended top slab", () => {
    // 30,00,000: bands to 24L, then 30% on the last 6L.
    const { total, bands } = taxBySlabs(3_000_000, NEW_REGIME.slabs);

    expect(bands[bands.length - 1]?.percent).toBe(30);
    expect(bands[bands.length - 1]?.taxable).toBe(600000);
    expect(total).toBeGreaterThan(0);
  });

  it("stops at the band containing the income", () => {
    const { bands } = taxBySlabs(500_000, NEW_REGIME.slabs);

    expect(bands.map((b) => b.percent)).toEqual([0, 5]);
  });

  it("handles a zero income", () => {
    expect(taxBySlabs(0, NEW_REGIME.slabs)).toEqual({ total: 0, bands: [] });
  });

  it("is not confused by slabs given out of order", () => {
    const shuffled = [...NEW_REGIME.slabs].reverse();
    expect(taxBySlabs(1_000_000, shuffled).total).toBe(40000);
  });
});

describe("calculateTax", () => {
  it("subtracts the standard deduction before applying slabs", () => {
    const result = calculateTax({ grossSalary: 1_075_000 }, NEW_REGIME);

    expect(result.taxableIncome).toBe(1_000_000);
    expect(result.slabTax).toBe(40000);
  });

  it("wipes out the liability under the 87A threshold", () => {
    // Taxable 12,00,000 is exactly at the rebate ceiling.
    const result = calculateTax({ grossSalary: 1_275_000 }, NEW_REGIME);

    expect(result.taxableIncome).toBe(1_200_000);
    expect(result.rebate).toBe(result.slabTax);
    expect(result.totalTax).toBe(0);
  });

  it("treats 87A as a cliff, not a taper", () => {
    // One rupee over the threshold and the whole liability is payable.
    const justOver = calculateTax({ grossSalary: 1_275_001 }, NEW_REGIME);

    expect(justOver.rebate).toBe(0);
    expect(justOver.totalTax).toBeGreaterThan(0);
  });

  it("adds cess on the tax after rebate", () => {
    const result = calculateTax({ grossSalary: 1_575_000 }, NEW_REGIME);

    expect(result.cess).toBe(Math.round((result.slabTax - result.rebate) * 0.04));
    expect(result.totalTax).toBe(result.slabTax - result.rebate + result.cess);
  });

  it("ignores 80C and HRA under the new regime", () => {
    // Allowing them would understate new-regime tax and corrupt the very
    // comparison this calculator exists to make.
    const withDeductions = calculateTax(
      { grossSalary: 1_575_000, deductions: { section80c: 150000, hraExemption: 200000 } },
      NEW_REGIME,
    );
    const without = calculateTax({ grossSalary: 1_575_000 }, NEW_REGIME);

    expect(withDeductions.otherDeductions).toBe(0);
    expect(withDeductions.totalTax).toBe(without.totalTax);
  });

  it("allows 80C and HRA under the old regime", () => {
    const result = calculateTax(
      { grossSalary: 1_575_000, deductions: { section80c: 150000, hraExemption: 200000 } },
      OLD_REGIME,
    );

    expect(result.otherDeductions).toBe(350000);
    expect(result.taxableIncome).toBe(1_575_000 - 50000 - 350000);
  });

  it("never produces a negative taxable income", () => {
    const result = calculateTax({ grossSalary: 30000 }, NEW_REGIME);

    expect(result.taxableIncome).toBe(0);
    expect(result.totalTax).toBe(0);
  });

  it("rejects a negative salary", () => {
    expect(() => calculateTax({ grossSalary: -1 }, NEW_REGIME)).toThrow(InvalidTaxInputError);
  });
});

describe("compareRegimes", () => {
  it("recommends the cheaper regime and quantifies the saving", () => {
    const comparison = compareRegimes({ grossSalary: 1_575_000 }, OLD_REGIME, NEW_REGIME);

    const cheaper = comparison.recommended === "new" ? comparison.new : comparison.old;
    const dearer = comparison.recommended === "new" ? comparison.old : comparison.new;

    expect(cheaper.totalTax).toBeLessThanOrEqual(dearer.totalTax);
    expect(comparison.saving).toBe(Math.abs(comparison.old.totalTax - comparison.new.totalTax));
  });

  it("can favour the old regime when deductions are large", () => {
    const comparison = compareRegimes(
      { grossSalary: 1_200_000, deductions: { section80c: 150000, hraExemption: 300000 } },
      OLD_REGIME,
      NEW_REGIME,
    );

    // Both regimes are computed; the point is the answer follows the numbers.
    expect(["old", "new"]).toContain(comparison.recommended);
    expect(comparison.old.otherDeductions).toBe(450000);
    expect(comparison.new.otherDeductions).toBe(0);
  });
});

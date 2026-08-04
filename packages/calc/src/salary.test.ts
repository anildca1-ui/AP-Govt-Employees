import { describe, expect, it } from "vitest";
import { calculateSalary, InvalidSalaryInputError } from "./salary.js";
import type { RateRow } from "./rates.js";

const RATES: RateRow<{ percent: number }>[] = [
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
  {
    kind: "HRA",
    effective_from: "2022-01-01",
    effective_to: null,
    payload: {
      percent: 0,
      _source_go: { go_number: "G.O.27", go_date: null, verified: false },
      _unverified: true,
    },
  },
];

describe("calculateSalary", () => {
  const base = { basicPay: 52590, hraPercent: 16, onDate: "2025-06-01" };

  it("computes DA and HRA on basic pay", () => {
    // 52,590 → DA 37.31% = 19,621; HRA 16% = 8,414.
    const result = calculateSalary(base, RATES);

    expect(result.da).toBe(19621);
    expect(result.hra).toBe(8414);
    expect(result.gross).toBe(52590 + 19621 + 8414);
  });

  it("computes HRA on basic alone, not on basic + DA", () => {
    // A common mistake; RPS-2022 HRA is a percentage of basic pay only.
    const result = calculateSalary(base, RATES);
    const wrong = Math.round(((52590 + 19621) * 16) / 100);

    expect(result.hra).not.toBe(wrong);
    expect(result.hra).toBe(Math.round((52590 * 16) / 100));
  });

  it("adds CCA when admissible", () => {
    const result = calculateSalary({ ...base, cca: 500 }, RATES);

    expect(result.cca).toBe(500);
    expect(result.gross).toBe(52590 + 19621 + 8414 + 500);
  });

  it("subtracts deductions to reach net", () => {
    const result = calculateSalary(
      {
        ...base,
        deductions: { providentFund: 5000, apgli: 600, gis: 120, professionalTax: 200 },
      },
      RATES,
    );

    expect(result.totalDeductions).toBe(5920);
    expect(result.net).toBe(result.gross - 5920);
  });

  it("omits zero deductions from the breakdown", () => {
    const result = calculateSalary({ ...base, deductions: { providentFund: 5000 } }, RATES);

    expect(result.breakdown.filter((row) => row.label.startsWith("−"))).toHaveLength(1);
  });

  it("labels the DA and HRA rows with the percentages used", () => {
    // The reader has to be able to see which rate produced the figure.
    const labels = calculateSalary(base, RATES).breakdown.map((row) => row.label);

    expect(labels).toContain("DA @ 37.31%");
    expect(labels).toContain("HRA @ 16%");
  });

  it("cites both the DA and HRA GOs", () => {
    const result = calculateSalary(base, RATES);

    expect(result.sourceGos).toContain("G.O.Ms.No.60");
    expect(result.sourceGos).toContain("G.O.27");
    expect(result.unverified).toBe(true);
  });

  it("still works when no HRA row is on record", () => {
    // The user supplied the percentage; only provenance is lost.
    const daOnly = RATES.filter((row) => row.kind === "DA");
    const result = calculateSalary(base, daOnly);

    expect(result.hra).toBe(8414);
    expect(result.sourceGos).toEqual(["G.O.Ms.No.60"]);
  });

  it("refuses to compute without a DA rate for the date", () => {
    expect(() => calculateSalary({ ...base, onDate: "2019-01-01" }, RATES)).toThrow(
      /No DA rate is on record/,
    );
  });

  it("rejects nonsensical pay or HRA", () => {
    expect(() => calculateSalary({ ...base, basicPay: 0 }, RATES)).toThrow(InvalidSalaryInputError);
    expect(() => calculateSalary({ ...base, hraPercent: -1 }, RATES)).toThrow(
      InvalidSalaryInputError,
    );
  });

  it("handles an employee with no HRA", () => {
    const result = calculateSalary({ ...base, hraPercent: 0 }, RATES);

    expect(result.hra).toBe(0);
    expect(result.gross).toBe(52590 + 19621);
  });
});

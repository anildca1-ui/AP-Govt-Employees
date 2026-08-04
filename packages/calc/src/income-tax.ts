import { roundRupees, type Rupees } from "./money.js";

/**
 * Calculator 10 — income tax, old regime versus new (PLAN.md Part 4).
 *
 * Slabs, the standard deduction, the rebate threshold and the cess all come
 * from the rates table per financial year. Nothing here is a constant: the
 * numbers change every Budget, and a stale rate hardcoded in a component is
 * exactly what rule 1 forbids.
 */

export interface TaxSlab {
  /** Upper bound of the slab, or null for the top slab. */
  upto: number | null;
  percent: number;
}

export interface TaxRegimePayload {
  regime: "old" | "new";
  fy: string;
  slabs: TaxSlab[];
  standardDeduction: number;
  /** Total income at or below which section 87A wipes out the liability. */
  rebate87aUpto: number;
  cessPercent: number;
}

export interface TaxInput {
  grossSalary: number;
  /** Deductions admissible in the old regime only. */
  deductions?: {
    section80c?: number;
    section80d?: number;
    hraExemption?: number;
    professionalTax?: number;
    other?: number;
  };
}

export interface TaxResult {
  regime: "old" | "new";
  fy: string;
  grossSalary: Rupees;
  standardDeduction: Rupees;
  otherDeductions: Rupees;
  taxableIncome: Rupees;
  slabTax: Rupees;
  rebate: Rupees;
  cess: Rupees;
  totalTax: Rupees;
  bands: { band: string; taxable: Rupees; percent: number; tax: Rupees }[];
}

export class InvalidTaxInputError extends Error {}

/** Tax on income by slabs — marginal, so each band taxes only its own slice. */
export function taxBySlabs(
  taxableIncome: number,
  slabs: TaxSlab[],
): { total: number; bands: TaxResult["bands"] } {
  const ordered = [...slabs].sort((a, b) => {
    if (a.upto === null) return 1;
    if (b.upto === null) return -1;
    return a.upto - b.upto;
  });

  let previousCeiling = 0;
  let total = 0;
  const bands: TaxResult["bands"] = [];

  for (const slab of ordered) {
    const ceiling = slab.upto ?? Number.POSITIVE_INFINITY;
    const slice = Math.max(0, Math.min(taxableIncome, ceiling) - previousCeiling);
    if (slice > 0) {
      const tax = (slice * slab.percent) / 100;
      total += tax;
      bands.push({
        band:
          slab.upto === null
            ? `above ${previousCeiling.toLocaleString("en-IN")}`
            : `${previousCeiling.toLocaleString("en-IN")}–${slab.upto.toLocaleString("en-IN")}`,
        taxable: roundRupees(slice),
        percent: slab.percent,
        tax: roundRupees(tax),
      });
    }
    previousCeiling = ceiling;
    if (taxableIncome <= ceiling) break;
  }

  return { total, bands };
}

export function calculateTax(input: TaxInput, regime: TaxRegimePayload): TaxResult {
  const { grossSalary, deductions = {} } = input;

  if (!Number.isFinite(grossSalary) || grossSalary < 0) {
    throw new InvalidTaxInputError(`Gross salary must be >= 0, received ${grossSalary}`);
  }

  // Chapter VI-A deductions and the HRA exemption are old-regime only; allowing
  // them under the new regime would understate tax and mislead the comparison,
  // which is the whole purpose of this calculator.
  const otherDeductions =
    regime.regime === "old"
      ? (deductions.section80c ?? 0) +
        (deductions.section80d ?? 0) +
        (deductions.hraExemption ?? 0) +
        (deductions.professionalTax ?? 0) +
        (deductions.other ?? 0)
      : 0;

  const taxableIncome = Math.max(0, grossSalary - regime.standardDeduction - otherDeductions);
  const { total: slabTax, bands } = taxBySlabs(taxableIncome, regime.slabs);

  // 87A is all-or-nothing at the threshold, not a taper.
  const rebate = taxableIncome <= regime.rebate87aUpto ? slabTax : 0;
  const afterRebate = slabTax - rebate;
  const cess = (afterRebate * regime.cessPercent) / 100;

  return {
    regime: regime.regime,
    fy: regime.fy,
    grossSalary: roundRupees(grossSalary),
    standardDeduction: roundRupees(regime.standardDeduction),
    otherDeductions: roundRupees(otherDeductions),
    taxableIncome: roundRupees(taxableIncome),
    slabTax: roundRupees(slabTax),
    rebate: roundRupees(rebate),
    cess: roundRupees(cess),
    totalTax: roundRupees(afterRebate + cess),
    bands,
  };
}

export interface RegimeComparison {
  old: TaxResult;
  new: TaxResult;
  recommended: "old" | "new";
  saving: Rupees;
}

/** Runs both regimes and names the cheaper one, which is the actual question. */
export function compareRegimes(
  input: TaxInput,
  oldRegime: TaxRegimePayload,
  newRegime: TaxRegimePayload,
): RegimeComparison {
  const oldResult = calculateTax(input, oldRegime);
  const newResult = calculateTax(input, newRegime);

  const recommended = newResult.totalTax <= oldResult.totalTax ? "new" : "old";

  return {
    old: oldResult,
    new: newResult,
    recommended,
    saving: Math.abs(oldResult.totalTax - newResult.totalTax),
  };
}

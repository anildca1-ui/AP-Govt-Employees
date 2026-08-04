import { roundRupees, type Rupees } from "./money.js";
import { rateOn, type RateRow } from "./rates.js";

/**
 * Calculator 4 — full salary (PLAN.md Part 4).
 *
 * basic → DA + HRA + CCA − deductions → net. Every rate comes from the rates
 * table; the only numbers the caller supplies are their own circumstances.
 */

export interface HraSlab {
  percent: number;
  band: string;
}

export interface HraPayload {
  slabs: HraSlab[];
}

export interface SalaryInput {
  basicPay: number;
  /** Which HRA slab applies, as a percentage — the city class, chosen by the user. */
  hraPercent: number;
  /** City Compensatory Allowance, a flat amount where admissible. */
  cca?: number;
  /** Date the salary is for, so the right DA applies. Defaults to today. */
  onDate?: string;
  deductions?: {
    /** GPF (OPS) or CPS/NPS employee share. */
    providentFund?: number;
    apgli?: number;
    gis?: number;
    professionalTax?: number;
    incomeTax?: number;
    other?: number;
  };
}

export interface SalaryResult {
  basicPay: Rupees;
  daPercent: number;
  da: Rupees;
  hraPercent: number;
  hra: Rupees;
  cca: Rupees;
  gross: Rupees;
  totalDeductions: Rupees;
  net: Rupees;
  breakdown: { label: string; amount: Rupees }[];
  sourceGos: string[];
  unverified: boolean;
}

export class InvalidSalaryInputError extends Error {}

export function calculateSalary(
  input: SalaryInput,
  rates: RateRow<{ percent: number } & Partial<HraPayload>>[],
): SalaryResult {
  const { basicPay, hraPercent, cca = 0, onDate, deductions = {} } = input;

  if (!Number.isFinite(basicPay) || basicPay <= 0) {
    throw new InvalidSalaryInputError(`Basic pay must be positive, received ${basicPay}`);
  }
  if (!Number.isFinite(hraPercent) || hraPercent < 0) {
    throw new InvalidSalaryInputError(`HRA percentage must be >= 0, received ${hraPercent}`);
  }

  const date = onDate ?? new Date().toISOString().slice(0, 10);
  const da = rateOn(rates, "DA", date);
  const daPercent = da.payload.percent;

  const sourceGos = new Set<string>();
  if (da.source?.go_number) sourceGos.add(da.source.go_number);
  let unverified = da.unverified;

  // HRA is looked up for provenance even though the caller picks the slab: the
  // page has to be able to say which GO set the slabs (rule 1).
  try {
    const hra = rateOn(rates, "HRA", date);
    if (hra.source?.go_number) sourceGos.add(hra.source.go_number);
    if (hra.unverified) unverified = true;
  } catch {
    // No HRA row on record is not fatal — the user supplied the percentage.
  }

  // DA and HRA are both percentages of basic pay alone in RPS-2022; HRA is not
  // computed on basic+DA.
  const daAmount = roundRupees((basicPay * daPercent) / 100);
  const hraAmount = roundRupees((basicPay * hraPercent) / 100);
  const ccaAmount = roundRupees(cca);
  const gross = roundRupees(basicPay) + daAmount + hraAmount + ccaAmount;

  const deductionRows: { label: string; amount: Rupees }[] = [
    { label: "GPF / CPS", amount: roundRupees(deductions.providentFund ?? 0) },
    { label: "APGLI", amount: roundRupees(deductions.apgli ?? 0) },
    { label: "GIS", amount: roundRupees(deductions.gis ?? 0) },
    { label: "Professional Tax", amount: roundRupees(deductions.professionalTax ?? 0) },
    { label: "Income Tax", amount: roundRupees(deductions.incomeTax ?? 0) },
    { label: "Other", amount: roundRupees(deductions.other ?? 0) },
  ].filter((row) => row.amount !== 0);

  const totalDeductions = deductionRows.reduce((sum, row) => sum + row.amount, 0);

  return {
    basicPay: roundRupees(basicPay),
    daPercent,
    da: daAmount,
    hraPercent,
    hra: hraAmount,
    cca: ccaAmount,
    gross,
    totalDeductions,
    net: gross - totalDeductions,
    breakdown: [
      { label: "Basic Pay", amount: roundRupees(basicPay) },
      { label: `DA @ ${daPercent}%`, amount: daAmount },
      { label: `HRA @ ${hraPercent}%`, amount: hraAmount },
      ...(ccaAmount === 0 ? [] : [{ label: "CCA", amount: ccaAmount }]),
      ...deductionRows.map((row) => ({ label: `− ${row.label}`, amount: -row.amount })),
    ],
    sourceGos: [...sourceGos],
    unverified,
  };
}

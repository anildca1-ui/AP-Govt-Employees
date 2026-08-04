import { roundRupees, type Rupees } from "./money.js";
import { rateOn, type RateRow } from "./rates.js";

/**
 * Calculator 1 — DA arrears (PLAN.md Part 4).
 *
 * When a DA revision is sanctioned with retrospective effect, the employee is
 * owed the difference for every month since. This walks those months, applying
 * whichever DA was actually in force in each, and shows the working: an arrears
 * figure nobody can check is worth nothing.
 */

export interface DaArrearsInput {
  basicPay: number;
  /** Inclusive first month, yyyy-mm. */
  fromMonth: string;
  /** Inclusive last month, yyyy-mm. */
  toMonth: string;
  /**
   * DA the employee was actually paid, as a percentage. Usually the old rate
   * across the whole period; that is what the arrears are the difference from.
   */
  paidDaPercent: number;
  /**
   * Portion paid as cash rather than credited to GPF/CPS, 0..1. The sanctioning
   * GO sets this — G.O.Ms.No.60 for instance pays part in cash and the rest in
   * instalments — so it is an input, never a constant.
   */
  cashFraction?: number;
}

export interface DaArrearsMonth {
  /** yyyy-mm. */
  month: string;
  basicPay: Rupees;
  paidDaPercent: number;
  dueDaPercent: number;
  paidDa: Rupees;
  dueDa: Rupees;
  difference: Rupees;
  sourceGo: string | null;
}

export interface DaArrearsResult {
  months: DaArrearsMonth[];
  total: Rupees;
  cash: Rupees;
  gpfOrCps: Rupees;
  /** True when any rate used has not been verified against its GO. */
  unverified: boolean;
  /** GO numbers the calculation drew on, for the "as per" line. */
  sourceGos: string[];
}

export class InvalidPeriodError extends Error {}

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** Inclusive list of yyyy-mm between two months. */
export function monthsBetween(fromMonth: string, toMonth: string): string[] {
  if (!MONTH_PATTERN.test(fromMonth)) throw new InvalidPeriodError(`Bad month: ${fromMonth}`);
  if (!MONTH_PATTERN.test(toMonth)) throw new InvalidPeriodError(`Bad month: ${toMonth}`);
  if (fromMonth > toMonth) {
    throw new InvalidPeriodError(`${fromMonth} is after ${toMonth}`);
  }

  const months: string[] = [];
  let [year, month] = fromMonth.split("-").map(Number) as [number, number];
  const [endYear, endMonth] = toMonth.split("-").map(Number) as [number, number];

  // Integer month arithmetic, not Date: a Date-based loop in a timezone behind
  // UTC lands on the last day of the previous month and drops a month's arrears.
  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }

  return months;
}

export function calculateDaArrears(
  input: DaArrearsInput,
  rates: RateRow<{ percent: number }>[],
): DaArrearsResult {
  const { basicPay, fromMonth, toMonth, paidDaPercent, cashFraction = 1 } = input;

  if (!Number.isFinite(basicPay) || basicPay <= 0) {
    throw new InvalidPeriodError(`Basic pay must be a positive number, received ${basicPay}`);
  }
  if (cashFraction < 0 || cashFraction > 1) {
    throw new InvalidPeriodError(`cashFraction must be between 0 and 1, received ${cashFraction}`);
  }

  const months: DaArrearsMonth[] = [];
  const sourceGos = new Set<string>();
  let unverified = false;
  let total = 0;

  for (const month of monthsBetween(fromMonth, toMonth)) {
    // The rate in force on the first of the month: DA revisions take effect
    // from a date, and a mid-month change applies to the whole month's pay.
    const resolved = rateOn(rates, "DA", `${month}-01`);
    const dueDaPercent = resolved.payload.percent;

    const paidDa = roundRupees((basicPay * paidDaPercent) / 100);
    const dueDa = roundRupees((basicPay * dueDaPercent) / 100);
    const difference = dueDa - paidDa;

    if (resolved.unverified) unverified = true;
    if (resolved.source?.go_number) sourceGos.add(resolved.source.go_number);

    months.push({
      month,
      basicPay: roundRupees(basicPay),
      paidDaPercent,
      dueDaPercent,
      paidDa,
      dueDa,
      difference,
      sourceGo: resolved.source?.go_number ?? null,
    });

    total += difference;
  }

  // Rounded once at the split, not per month, so cash + gpf always equals total
  // exactly — a one-rupee discrepancy in a pay bill costs someone an afternoon.
  const cash = roundRupees(total * cashFraction);

  return {
    months,
    total: roundRupees(total),
    cash,
    gpfOrCps: roundRupees(total) - cash,
    unverified,
    sourceGos: [...sourceGos],
  };
}

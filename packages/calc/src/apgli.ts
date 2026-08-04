import { roundRupees, type Rupees } from "./money.js";

/**
 * Calculator 11 (first half) — APGLI premium and bonus.
 *
 * The compulsory premium is a slab of basic pay, and the slab table comes from
 * the governing GO via the rates table. It is passed in rather than embedded:
 * the slabs change with each PRC, and a stale table here would under-deduct for
 * years before anyone noticed.
 */

export interface ApgliSlab {
  /** Slab applies when basic pay is at or above this. */
  fromBasic: number;
  /** Monthly compulsory premium for the slab. */
  premium: number;
}

export interface ApgliInput {
  basicPay: number;
  slabs: ApgliSlab[];
  /** Additional voluntary premium above the compulsory minimum. */
  voluntaryPremium?: number;
  /** Years the policy will run to maturity. */
  yearsToMaturity?: number;
  /** Bonus per ₹1,000 sum assured per year, from the governing GO. */
  bonusPerThousandPerYear?: number;
  sumAssured?: number;
}

export interface ApgliResult {
  compulsoryPremium: Rupees;
  voluntaryPremium: Rupees;
  monthlyPremium: Rupees;
  annualPremium: Rupees;
  totalPremiumToMaturity: Rupees | null;
  projectedBonus: Rupees | null;
  maturityValue: Rupees | null;
}

export class NoApgliSlabError extends Error {
  constructor(basicPay: number) {
    super(
      `No APGLI slab covers a basic pay of ${basicPay}. The slab table comes ` +
        `from the rates table — seed or extend it rather than assuming a premium.`,
    );
    this.name = "NoApgliSlabError";
  }
}

/** The premium for a basic pay: the highest slab at or below it. */
export function premiumForBasic(basicPay: number, slabs: ApgliSlab[]): number {
  const applicable = slabs
    .filter((slab) => basicPay >= slab.fromBasic)
    .sort((a, b) => b.fromBasic - a.fromBasic)[0];

  if (applicable === undefined) throw new NoApgliSlabError(basicPay);
  return applicable.premium;
}

export function calculateApgli(input: ApgliInput): ApgliResult {
  const {
    basicPay,
    slabs,
    voluntaryPremium = 0,
    yearsToMaturity,
    bonusPerThousandPerYear,
    sumAssured,
  } = input;

  const compulsory = premiumForBasic(basicPay, slabs);
  const monthly = compulsory + voluntaryPremium;

  const totalToMaturity =
    yearsToMaturity === undefined ? null : roundRupees(monthly * 12 * yearsToMaturity);

  const bonus =
    yearsToMaturity !== undefined &&
    bonusPerThousandPerYear !== undefined &&
    sumAssured !== undefined
      ? roundRupees((sumAssured / 1000) * bonusPerThousandPerYear * yearsToMaturity)
      : null;

  return {
    compulsoryPremium: roundRupees(compulsory),
    voluntaryPremium: roundRupees(voluntaryPremium),
    monthlyPremium: roundRupees(monthly),
    annualPremium: roundRupees(monthly * 12),
    totalPremiumToMaturity: totalToMaturity,
    projectedBonus: bonus,
    maturityValue:
      bonus === null || sumAssured === undefined ? null : roundRupees(sumAssured + bonus),
  };
}

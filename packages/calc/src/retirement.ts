import { roundRupees, type Rupees } from "./money.js";

/**
 * Calculators 5-9, 11 and 12 (PLAN.md Part 4) — the retirement family.
 *
 * They share one set of inputs (last pay, DA, qualifying service) and are
 * grouped so those inputs are defined once and cannot drift apart between
 * pages that must agree.
 *
 * Every function here takes its rule parameters — contribution percentages,
 * ceilings, commutation factors — as arguments sourced from the rates table.
 * None are constants (CLAUDE.md rule 1), and where the governing rule has not
 * been confirmed against a GO the caller must pass it explicitly rather than
 * inherit a guess.
 */

// ─── 5. NPS / CPS corpus projection ─────────────────────────────────────────

export interface NpsInput {
  basicPay: number;
  daPercent: number;
  /** Employee share of (basic + DA), from rates. Typically 10. */
  employeePercent: number;
  /** Government share of (basic + DA), from rates. Typically 14. */
  governmentPercent: number;
  yearsToRetirement: number;
  /** Expected annual return, e.g. 8 for 8%. The user's assumption, not ours. */
  annualReturnPercent: number;
  /** Expected annual pay growth, compounding the contribution base. */
  annualIncrementPercent?: number;
}

export interface NpsResult {
  monthlyEmployee: Rupees;
  monthlyGovernment: Rupees;
  monthlyTotal: Rupees;
  totalContributed: Rupees;
  projectedCorpus: Rupees;
  growth: Rupees;
}

export class InvalidInputError extends Error {}

function positive(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new InvalidInputError(`${name} must be a non-negative number, received ${value}`);
  }
}

/**
 * Month-by-month compounding, not an annuity formula.
 *
 * Contributions grow with pay and the balance compounds monthly, so a closed
 * form would need assumptions the employee cannot check. Stepping the months
 * makes the projection auditable and handles the increment correctly.
 */
export function projectNps(input: NpsInput): NpsResult {
  const {
    basicPay,
    daPercent,
    employeePercent,
    governmentPercent,
    yearsToRetirement,
    annualReturnPercent,
    annualIncrementPercent = 0,
  } = input;

  positive(basicPay, "basicPay");
  positive(yearsToRetirement, "yearsToRetirement");
  positive(annualReturnPercent, "annualReturnPercent");

  const monthlyReturn = annualReturnPercent / 100 / 12;
  const months = Math.round(yearsToRetirement * 12);

  let pay = basicPay;
  let corpus = 0;
  let contributed = 0;

  for (let month = 0; month < months; month++) {
    const base = pay * (1 + daPercent / 100);
    const employee = (base * employeePercent) / 100;
    const government = (base * governmentPercent) / 100;
    const contribution = employee + government;

    corpus = corpus * (1 + monthlyReturn) + contribution;
    contributed += contribution;

    // Pay steps up once a year, on the anniversary.
    if ((month + 1) % 12 === 0) pay *= 1 + annualIncrementPercent / 100;
  }

  const base = basicPay * (1 + daPercent / 100);

  // Derived from the rounded figures, not rounded independently: the page shows
  // all three, and "corpus − contributed" has to equal the growth on screen.
  // Rounding each separately puts them a rupee out and invites a support query
  // about arithmetic that is in fact correct.
  const projectedCorpus = roundRupees(corpus);
  const totalContributed = roundRupees(contributed);

  return {
    monthlyEmployee: roundRupees((base * employeePercent) / 100),
    monthlyGovernment: roundRupees((base * governmentPercent) / 100),
    monthlyTotal: roundRupees((base * (employeePercent + governmentPercent)) / 100),
    totalContributed,
    projectedCorpus,
    growth: projectedCorpus - totalContributed,
  };
}

// ─── 6. GPS estimate, and the CPS comparison ────────────────────────────────

export interface GpsInput {
  lastBasicPay: number;
  /** Assured fraction of last basic under the AP GPS Act, from rates. */
  assuredPercent: number;
  /** Corpus a CPS annuity would be bought from, for the comparison. */
  cpsCorpus?: number;
  /** Annuity rate used to convert that corpus to a monthly pension. */
  annuityRatePercent?: number;
}

export interface GpsResult {
  assuredMonthlyPension: Rupees;
  cpsMonthlyPension: Rupees | null;
  difference: Rupees | null;
  /** Always true — this is an estimate, and PLAN.md Part 4 says to say so. */
  isEstimate: true;
}

export function estimateGps(input: GpsInput): GpsResult {
  const { lastBasicPay, assuredPercent, cpsCorpus, annuityRatePercent } = input;
  positive(lastBasicPay, "lastBasicPay");

  const assured = roundRupees((lastBasicPay * assuredPercent) / 100);

  const cps =
    cpsCorpus !== undefined && annuityRatePercent !== undefined
      ? roundRupees((cpsCorpus * annuityRatePercent) / 100 / 12)
      : null;

  return {
    assuredMonthlyPension: assured,
    cpsMonthlyPension: cps,
    difference: cps === null ? null : assured - cps,
    isEstimate: true,
  };
}

// ─── 7. OPS pension and commutation ─────────────────────────────────────────

export interface OpsPensionInput {
  lastPay: number;
  /** Qualifying service in completed years. */
  qualifyingYears: number;
  /** Service required for a full pension, from rules. Typically 20. */
  fullPensionYears: number;
  /** Fraction of last pay at full service, from rules. Typically 50. */
  pensionPercent: number;
  /** Maximum commutable fraction of pension, from rules. Typically 40. */
  maxCommutationPercent?: number;
  /** Age-based factor from the commutation table in the governing GO. */
  commutationFactor?: number;
}

export interface OpsPensionResult {
  monthlyPension: Rupees;
  proRated: boolean;
  commutedPortion: Rupees | null;
  commutedLumpSum: Rupees | null;
  residualPension: Rupees | null;
}

export function calculateOpsPension(input: OpsPensionInput): OpsPensionResult {
  const {
    lastPay,
    qualifyingYears,
    fullPensionYears,
    pensionPercent,
    maxCommutationPercent,
    commutationFactor,
  } = input;

  positive(lastPay, "lastPay");
  positive(qualifyingYears, "qualifyingYears");

  const full = (lastPay * pensionPercent) / 100;
  // Short service is pro-rated; longer service does not earn more than full.
  const proRated = qualifyingYears < fullPensionYears;
  const monthly = proRated ? (full * qualifyingYears) / fullPensionYears : full;
  const monthlyPension = roundRupees(monthly);

  if (maxCommutationPercent === undefined || commutationFactor === undefined) {
    return {
      monthlyPension,
      proRated,
      commutedPortion: null,
      commutedLumpSum: null,
      residualPension: null,
    };
  }

  const commutedPortion = roundRupees((monthly * maxCommutationPercent) / 100);
  // The standard formula: commuted monthly amount × factor × 12.
  const commutedLumpSum = roundRupees(commutedPortion * commutationFactor * 12);

  return {
    monthlyPension,
    proRated,
    commutedPortion,
    commutedLumpSum,
    residualPension: monthlyPension - commutedPortion,
  };
}

// ─── 8. Gratuity ────────────────────────────────────────────────────────────

export interface GratuityInput {
  lastBasicPay: number;
  daPercent: number;
  qualifyingYears: number;
  /** Half-months of emoluments per year of service, from rules. Typically 1. */
  halfMonthsPerYear?: number;
  /** Maximum half-months payable, from rules. Typically 33 (16.5 months). */
  maxHalfMonths?: number;
  /** Absolute ceiling in rupees, from rates. */
  ceiling?: number;
}

export interface GratuityResult {
  emoluments: Rupees;
  halfMonthsEarned: number;
  computed: Rupees;
  payable: Rupees;
  cappedByCeiling: boolean;
  cappedByMaxService: boolean;
}

export function calculateGratuity(input: GratuityInput): GratuityResult {
  const {
    lastBasicPay,
    daPercent,
    qualifyingYears,
    halfMonthsPerYear = 1,
    maxHalfMonths = 33,
    ceiling,
  } = input;

  positive(lastBasicPay, "lastBasicPay");
  positive(qualifyingYears, "qualifyingYears");

  // Emoluments for gratuity are basic + DA, not basic alone.
  const emoluments = lastBasicPay * (1 + daPercent / 100);

  const earned = qualifyingYears * halfMonthsPerYear;
  const cappedByMaxService = earned > maxHalfMonths;
  const halfMonthsEarned = cappedByMaxService ? maxHalfMonths : earned;

  const computed = (emoluments / 2) * halfMonthsEarned;
  const cappedByCeiling = ceiling !== undefined && computed > ceiling;

  return {
    emoluments: roundRupees(emoluments),
    halfMonthsEarned,
    computed: roundRupees(computed),
    payable: roundRupees(cappedByCeiling ? (ceiling as number) : computed),
    cappedByCeiling,
    cappedByMaxService,
  };
}

// ─── 9. Leave encashment and surrender leave ────────────────────────────────

export interface LeaveEncashmentInput {
  basicPay: number;
  daPercent: number;
  days: number;
  /** Maximum encashable days, from rules. Typically 300 at retirement. */
  maxDays?: number;
}

export interface LeaveEncashmentResult {
  perDay: Rupees;
  daysPaid: number;
  amount: Rupees;
  capped: boolean;
}

/**
 * Leave is valued at (basic + DA) / 30 per day — thirty, not the actual length
 * of the month, which is the rule and also why a naive per-month division gives
 * a different answer in February.
 */
export function calculateLeaveEncashment(input: LeaveEncashmentInput): LeaveEncashmentResult {
  const { basicPay, daPercent, days, maxDays } = input;

  positive(basicPay, "basicPay");
  positive(days, "days");

  const emoluments = basicPay * (1 + daPercent / 100);
  const perDay = emoluments / 30;
  const capped = maxDays !== undefined && days > maxDays;
  const daysPaid = capped ? (maxDays as number) : days;

  return {
    perDay: roundRupees(perDay),
    daysPaid,
    amount: roundRupees(perDay * daysPaid),
    capped,
  };
}

// ─── 11. GPF interest ───────────────────────────────────────────────────────

export interface GpfInput {
  openingBalance: number;
  monthlySubscription: number;
  /** Annual rate from rates; credited on the running monthly balance. */
  annualRatePercent: number;
  months?: number;
}

export interface GpfResult {
  openingBalance: Rupees;
  totalSubscribed: Rupees;
  interest: Rupees;
  closingBalance: Rupees;
}

/**
 * GPF interest accrues on the monthly running balance, so a subscription paid
 * in March earns one month's interest and one paid in April earns none that
 * year. Applying the annual rate to the closing balance overstates it badly.
 */
export function calculateGpf(input: GpfInput): GpfResult {
  const { openingBalance, monthlySubscription, annualRatePercent, months = 12 } = input;

  positive(openingBalance, "openingBalance");
  positive(monthlySubscription, "monthlySubscription");

  const monthlyRate = annualRatePercent / 100 / 12;
  let balance = openingBalance;
  let interest = 0;

  for (let month = 0; month < months; month++) {
    balance += monthlySubscription;
    const monthInterest = balance * monthlyRate;
    interest += monthInterest;
  }

  return {
    openingBalance: roundRupees(openingBalance),
    totalSubscribed: roundRupees(monthlySubscription * months),
    interest: roundRupees(interest),
    closingBalance: roundRupees(openingBalance + monthlySubscription * months + interest),
  };
}

// ─── 12. Retirement date and service length ─────────────────────────────────

export interface RetirementInput {
  /** ISO yyyy-mm-dd. */
  dateOfBirth: string;
  /** ISO yyyy-mm-dd. */
  dateOfJoining: string;
  /** Superannuation age in years, from rules. */
  retirementAge: number;
  /** ISO yyyy-mm-dd; defaults to today. */
  asOf?: string;
}

export interface RetirementResult {
  /** ISO yyyy-mm-dd — the last day of the month in which the age is attained. */
  retirementDate: string;
  totalServiceYears: number;
  completedServiceYears: number;
  remainingDays: number;
  alreadyRetired: boolean;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseIso(value: string, name: string): Date {
  if (!ISO_DATE.test(value)) throw new InvalidInputError(`${name} must be yyyy-mm-dd`);
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new InvalidInputError(`${name} is not a real date`);
  return date;
}

/**
 * AP employees retire on the AFTERNOON OF THE LAST DAY of the month in which
 * they attain superannuation age — not on their birthday. Someone born on the
 * 2nd serves almost a full extra month, and getting this wrong misstates both
 * the date and the pension.
 */
export function calculateRetirement(input: RetirementInput): RetirementResult {
  const { dateOfBirth, dateOfJoining, retirementAge, asOf } = input;

  const dob = parseIso(dateOfBirth, "dateOfBirth");
  const doj = parseIso(dateOfJoining, "dateOfJoining");
  const today = parseIso(asOf ?? new Date().toISOString().slice(0, 10), "asOf");

  if (doj < dob) throw new InvalidInputError("Date of joining is before date of birth");

  const attainsYear = dob.getUTCFullYear() + retirementAge;
  const attainsMonth = dob.getUTCMonth();
  // Day 0 of the following month is the last day of this one.
  const retirement = new Date(Date.UTC(attainsYear, attainsMonth + 1, 0));
  const retirementDate = retirement.toISOString().slice(0, 10);

  const msPerDay = 86_400_000;
  const totalServiceDays = Math.max(0, (retirement.getTime() - doj.getTime()) / msPerDay);
  const completedDays = Math.max(0, (today.getTime() - doj.getTime()) / msPerDay);
  const remainingDays = Math.max(0, Math.ceil((retirement.getTime() - today.getTime()) / msPerDay));

  return {
    retirementDate,
    totalServiceYears: Math.round((totalServiceDays / 365.25) * 100) / 100,
    completedServiceYears: Math.round((completedDays / 365.25) * 100) / 100,
    remainingDays,
    alreadyRetired: today > retirement,
  };
}

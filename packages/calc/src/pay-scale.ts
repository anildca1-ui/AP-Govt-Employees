import { rateOn, type RateRow } from "./rates.js";
import { CalcError } from "./errors.js";

/**
 * Calculators 2 and 3 — increment and promotion/AAS fixation (PLAN.md Part 4).
 *
 * Both are movements along the RPS-2022 master scale, so both are expressed
 * here as stage arithmetic over the scale from the rates table rather than
 * formulas over a rupee amount. The scale is the rule; a percentage would only
 * approximate it.
 */

export interface MasterScalePayload {
  stages: number[];
  minimum: number;
  maximum: number;
}

export class OffScaleError extends CalcError {
  constructor(pay: number) {
    super(
      "offScale",
      `${pay} is not a stage of the master scale. Pay must sit on a stage — ` +
        `check the figure, or the scale in the rates table if a new PRC has been issued.`,
      { pay },
    );
  }
}

/** Index of a pay on the scale, or -1. Exact match only: pay sits on a stage. */
export function stageIndex(stages: number[], pay: number): number {
  return stages.indexOf(pay);
}

/**
 * The next stage up.
 *
 * An annual increment moves the employee exactly one stage — it is not a
 * percentage, and the increment's rupee value changes as the scale's segments
 * change, which is precisely why this reads the scale rather than computing.
 */
export function nextStage(stages: number[], pay: number): number {
  const index = stageIndex(stages, pay);
  if (index === -1) throw new OffScaleError(pay);
  // At the maximum, pay stays put; stagnation increments are a separate rule.
  return index === stages.length - 1 ? pay : (stages[index + 1] as number);
}

export interface IncrementResult {
  currentBasic: number;
  newBasic: number;
  incrementAmount: number;
  atMaximum: boolean;
  sourceGo: string | null;
  unverified: boolean;
}

export function calculateIncrement(
  currentBasic: number,
  rates: RateRow<MasterScalePayload>[],
): IncrementResult {
  const scale = rateOn(rates, "MASTER_SCALE", new Date().toISOString().slice(0, 10));
  const stages = scale.payload.stages;
  const newBasic = nextStage(stages, currentBasic);

  return {
    currentBasic,
    newBasic,
    incrementAmount: newBasic - currentBasic,
    atMaximum: newBasic === currentBasic,
    sourceGo: scale.source?.go_number ?? null,
    unverified: scale.unverified,
  };
}

export interface FixationInput {
  currentBasic: number;
  /**
   * Minimum of the promotion post's scale. Fixation may not place the employee
   * below the new scale's floor.
   */
  promotionScaleMinimum?: number;
  /**
   * FR 22(a)(i) / FR 22-B: one notional increment in the lower scale first,
   * then fix at the next stage of the higher scale. The employee may opt out,
   * so it is a choice, not an assumption.
   */
  withNotionalIncrement?: boolean;
}

export interface FixationResult {
  currentBasic: number;
  notionalBasic: number;
  fixedBasic: number;
  raisedToScaleMinimum: boolean;
  steps: string[];
  sourceGo: string | null;
  unverified: boolean;
}

/**
 * Promotion / AAS 6-12-18-24 fixation.
 *
 * The steps are returned as text because a fixation an employee cannot follow
 * is one they cannot query with their DDO — and fixation disputes are common
 * enough that showing the working is the point.
 */
export function calculateFixation(
  input: FixationInput,
  rates: RateRow<MasterScalePayload>[],
): FixationResult {
  const { currentBasic, promotionScaleMinimum, withNotionalIncrement = true } = input;

  const scale = rateOn(rates, "MASTER_SCALE", new Date().toISOString().slice(0, 10));
  const stages = scale.payload.stages;

  if (stageIndex(stages, currentBasic) === -1) throw new OffScaleError(currentBasic);

  const steps: string[] = [];

  const notionalBasic = withNotionalIncrement ? nextStage(stages, currentBasic) : currentBasic;
  steps.push(
    withNotionalIncrement
      ? `Notional increment in the present scale: ${currentBasic} → ${notionalBasic}`
      : `No notional increment opted: pay stays at ${currentBasic}`,
  );

  let fixedBasic = notionalBasic;
  let raisedToScaleMinimum = false;

  if (promotionScaleMinimum !== undefined && fixedBasic < promotionScaleMinimum) {
    // Below the promotion scale's floor, fixation goes to the floor itself.
    const floorIndex = stages.findIndex((stage) => stage >= promotionScaleMinimum);
    if (floorIndex === -1) throw new OffScaleError(promotionScaleMinimum);
    fixedBasic = stages[floorIndex] as number;
    raisedToScaleMinimum = true;
    steps.push(`Below the promotion scale minimum, so fixed at ${fixedBasic}`);
  } else {
    steps.push(`Fixed at ${fixedBasic} in the promotion scale`);
  }

  return {
    currentBasic,
    notionalBasic,
    fixedBasic,
    raisedToScaleMinimum,
    steps,
    sourceGo: scale.source?.go_number ?? null,
    unverified: scale.unverified,
  };
}

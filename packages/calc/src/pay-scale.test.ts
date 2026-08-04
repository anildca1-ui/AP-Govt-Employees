import { describe, expect, it } from "vitest";
import {
  calculateFixation,
  calculateIncrement,
  nextStage,
  OffScaleError,
  stageIndex,
  type MasterScalePayload,
} from "./pay-scale.js";
import type { RateRow } from "./rates.js";

/** The first stages of the real RPS-2022 scale: 20000-600-21800-660-… */
const STAGES = [20000, 20600, 21200, 21800, 22460, 23120, 23780, 24500, 25220, 25940];

const SCALE: RateRow<MasterScalePayload>[] = [
  {
    kind: "MASTER_SCALE",
    effective_from: "2022-07-01",
    effective_to: null,
    payload: {
      stages: STAGES,
      minimum: 20000,
      maximum: 25940,
      _source_go: { go_number: "G.O.Ms.No.1", go_date: "2022-01-17", verified: false },
      _unverified: true,
    },
  },
];

describe("stageIndex / nextStage", () => {
  it("finds a pay that sits on a stage", () => {
    expect(stageIndex(STAGES, 21200)).toBe(2);
  });

  it("moves exactly one stage up, not by a percentage", () => {
    // The rupee value of an increment changes with the scale segment — 600 low
    // down, 660 further up — which is why this reads the scale.
    expect(nextStage(STAGES, 20000)).toBe(20600);
    expect(nextStage(STAGES, 21800)).toBe(22460);
  });

  it("stays put at the maximum of the scale", () => {
    expect(nextStage(STAGES, 25940)).toBe(25940);
  });

  it("refuses a pay that is not a stage", () => {
    // An off-scale figure means the pay or the scale is wrong; silently
    // rounding to a neighbour would fix pay at a stage the employee never held.
    expect(() => nextStage(STAGES, 20500)).toThrow(OffScaleError);
    expect(() => nextStage(STAGES, 0)).toThrow(OffScaleError);
  });
});

describe("calculateIncrement", () => {
  it("reports the new basic and the increment's value", () => {
    const result = calculateIncrement(21800, SCALE);

    expect(result.newBasic).toBe(22460);
    expect(result.incrementAmount).toBe(660);
    expect(result.atMaximum).toBe(false);
  });

  it("flags being at the maximum rather than inventing a stage", () => {
    const result = calculateIncrement(25940, SCALE);

    expect(result.newBasic).toBe(25940);
    expect(result.incrementAmount).toBe(0);
    expect(result.atMaximum).toBe(true);
  });

  it("carries the governing GO and the unverified flag", () => {
    const result = calculateIncrement(20000, SCALE);

    expect(result.sourceGo).toBe("G.O.Ms.No.1");
    expect(result.unverified).toBe(true);
  });
});

describe("calculateFixation", () => {
  it("gives a notional increment first, then fixes at that stage", () => {
    // FR 22(a)(i): one increment in the lower scale, then fixation.
    const result = calculateFixation({ currentBasic: 21200 }, SCALE);

    expect(result.notionalBasic).toBe(21800);
    expect(result.fixedBasic).toBe(21800);
    expect(result.steps[0]).toMatch(/Notional increment/);
  });

  it("skips the notional increment when the employee opts out", () => {
    const result = calculateFixation(
      { currentBasic: 21200, withNotionalIncrement: false },
      SCALE,
    );

    expect(result.notionalBasic).toBe(21200);
    expect(result.steps[0]).toMatch(/No notional increment/);
  });

  it("raises pay to the promotion scale's floor when it falls below", () => {
    const result = calculateFixation(
      { currentBasic: 20000, promotionScaleMinimum: 23120 },
      SCALE,
    );

    expect(result.fixedBasic).toBe(23120);
    expect(result.raisedToScaleMinimum).toBe(true);
  });

  it("does not lower pay to the floor when it is already above", () => {
    const result = calculateFixation(
      { currentBasic: 24500, promotionScaleMinimum: 21800 },
      SCALE,
    );

    expect(result.fixedBasic).toBe(25220);
    expect(result.raisedToScaleMinimum).toBe(false);
  });

  it("shows the working, because fixation gets disputed with the DDO", () => {
    const result = calculateFixation({ currentBasic: 20000, promotionScaleMinimum: 23120 }, SCALE);

    expect(result.steps).toHaveLength(2);
    expect(result.steps.join(" ")).toMatch(/20000/);
    expect(result.steps.join(" ")).toMatch(/23120/);
  });

  it("refuses an off-scale current pay", () => {
    expect(() => calculateFixation({ currentBasic: 20500 }, SCALE)).toThrow(OffScaleError);
  });
});

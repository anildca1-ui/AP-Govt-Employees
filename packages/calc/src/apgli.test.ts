import { describe, expect, it } from "vitest";
import { calculateApgli, NoApgliSlabError, premiumForBasic, type ApgliSlab } from "./apgli.js";
import { assessMedicalClaim } from "./medical.js";

const SLABS: ApgliSlab[] = [
  { fromBasic: 20000, premium: 300 },
  { fromBasic: 35000, premium: 600 },
  { fromBasic: 50000, premium: 1000 },
  { fromBasic: 80000, premium: 1500 },
];

describe("premiumForBasic", () => {
  it("takes the highest slab at or below the pay", () => {
    expect(premiumForBasic(52590, SLABS)).toBe(1000);
    expect(premiumForBasic(35000, SLABS)).toBe(600);
    expect(premiumForBasic(79999, SLABS)).toBe(1000);
    expect(premiumForBasic(80000, SLABS)).toBe(1500);
  });

  it("refuses a pay below every slab rather than guessing zero", () => {
    // A silent zero would under-deduct for years before anyone noticed.
    expect(() => premiumForBasic(15000, SLABS)).toThrow(NoApgliSlabError);
  });

  it("names the rates table in the error", () => {
    expect(() => premiumForBasic(15000, SLABS)).toThrow(/rates table/);
  });
});

describe("calculateApgli", () => {
  it("reports the compulsory premium monthly and annually", () => {
    const result = calculateApgli({ basicPay: 52590, slabs: SLABS });

    expect(result.compulsoryPremium).toBe(1000);
    expect(result.monthlyPremium).toBe(1000);
    expect(result.annualPremium).toBe(12000);
  });

  it("adds a voluntary premium on top", () => {
    const result = calculateApgli({ basicPay: 52590, slabs: SLABS, voluntaryPremium: 500 });

    expect(result.monthlyPremium).toBe(1500);
    expect(result.annualPremium).toBe(18000);
  });

  it("projects total premium to maturity", () => {
    const result = calculateApgli({ basicPay: 52590, slabs: SLABS, yearsToMaturity: 20 });

    expect(result.totalPremiumToMaturity).toBe(1000 * 12 * 20);
  });

  it("projects bonus and maturity value when the bonus rate is known", () => {
    // 5,00,000 assured, ₹70 per ₹1,000 per year, 20 years = 7,00,000 bonus.
    const result = calculateApgli({
      basicPay: 52590,
      slabs: SLABS,
      yearsToMaturity: 20,
      bonusPerThousandPerYear: 70,
      sumAssured: 500000,
    });

    expect(result.projectedBonus).toBe(700000);
    expect(result.maturityValue).toBe(1200000);
  });

  it("omits the projection when the bonus rate is unknown", () => {
    // The rate comes from the governing GO; inventing one produces a confident
    // maturity figure the employee would plan around.
    const result = calculateApgli({ basicPay: 52590, slabs: SLABS, yearsToMaturity: 20 });

    expect(result.projectedBonus).toBeNull();
    expect(result.maturityValue).toBeNull();
  });
});

describe("assessMedicalClaim", () => {
  it("routes an enrolled employee at an empanelled hospital to EHS", () => {
    const guidance = assessMedicalClaim({
      isEhsEnrolled: true,
      treatment: "inpatient",
      hospital: "ehs-empanelled",
      alreadyTreated: false,
    });

    expect(guidance.route).toBe("ehs");
    expect(guidance.documents.join(" ")).toMatch(/health card/i);
  });

  it("flags the most commonly rejected case honestly", () => {
    const guidance = assessMedicalClaim({
      isEhsEnrolled: true,
      treatment: "inpatient",
      hospital: "private-non-empanelled",
      alreadyTreated: true,
      hadPriorPermission: false,
    });

    expect(guidance.route).toBe("unlikely-to-be-payable");
    expect(guidance.reasons.join(" ")).toMatch(/rejected/i);
    // Discretionary, not a right — saying otherwise sets up a false expectation.
    expect(guidance.reasons.join(" ")).toMatch(/discretionary/i);
  });

  it("treats an emergency as admissible without prior permission", () => {
    const guidance = assessMedicalClaim({
      isEhsEnrolled: false,
      treatment: "emergency",
      hospital: "private-non-empanelled",
      alreadyTreated: true,
    });

    expect(guidance.route).toBe("medical-reimbursement");
    expect(guidance.documents.join(" ")).toMatch(/emergency certificate/i);
  });

  it("allows either route for a government hospital", () => {
    const guidance = assessMedicalClaim({
      isEhsEnrolled: true,
      treatment: "inpatient",
      hospital: "government",
      alreadyTreated: false,
    });

    expect(guidance.route).toBe("either");
  });

  it("always hands back a question for the chat, so the answer arrives cited", () => {
    // The helper narrows the question; the GO answers it (rule 1).
    for (const hospital of ["ehs-empanelled", "government", "private-non-empanelled"] as const) {
      const guidance = assessMedicalClaim({
        isEhsEnrolled: true,
        treatment: "inpatient",
        hospital,
        alreadyTreated: false,
      });

      expect(guidance.suggestedQuestion.length).toBeGreaterThan(20);
      expect(guidance.isGuidanceOnly).toBe(true);
    }
  });
});

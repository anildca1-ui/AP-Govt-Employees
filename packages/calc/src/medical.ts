/**
 * Calculator 13 — medical reimbursement eligibility helper (PLAN.md Part 4).
 *
 * "RAG-assisted, not pure math", as the spec puts it. So this is a decision
 * tree that narrows the question and then names what the answer depends on —
 * it never states the entitlement itself. The rules live in the AP Medical
 * Attendance Rules 1972 and the EHS orders, and an answer about someone's
 * hospital bill must come from those documents, not from a lookup table
 * embedded in a web page.
 *
 * The output is a recommendation plus the query to put to the RAG chat, so the
 * citation the employee ends up with is a real GO.
 */

export type TreatmentType = "inpatient" | "outpatient" | "emergency" | "diagnostic";
export type HospitalKind = "ehs-empanelled" | "government" | "private-non-empanelled";

export interface MedicalInput {
  /** EHS covers serving employees and pensioners who have enrolled. */
  isEhsEnrolled: boolean;
  treatment: TreatmentType;
  hospital: HospitalKind;
  /** True when the treatment was already taken and is being claimed after. */
  alreadyTreated: boolean;
  /** True when prior permission or a referral was obtained. */
  hadPriorPermission?: boolean;
}

export type MedicalRoute = "ehs" | "medical-reimbursement" | "either" | "unlikely-to-be-payable";

export interface MedicalGuidance {
  route: MedicalRoute;
  /** Plain-language reasons, in the order they apply. */
  reasons: string[];
  /** What the employee must produce; the usual reason a claim is rejected. */
  documents: string[];
  /** Ready-made question for the RAG chat, so the answer arrives cited. */
  suggestedQuestion: string;
  /**
   * Always true. This helper narrows the question; it does not decide the
   * claim, and saying so is the difference between guidance and a wrong promise.
   */
  isGuidanceOnly: true;
}

export function assessMedicalClaim(input: MedicalInput): MedicalGuidance {
  const { isEhsEnrolled, treatment, hospital, alreadyTreated, hadPriorPermission = false } = input;

  const reasons: string[] = [];
  const documents: string[] = ["Original bills and receipts", "Discharge summary or prescription"];

  let route: MedicalRoute;

  if (hospital === "ehs-empanelled" && isEhsEnrolled && treatment !== "outpatient") {
    // Empanelled + enrolled is the cashless path EHS exists to provide.
    route = "ehs";
    reasons.push("The hospital is EHS-empanelled and you are enrolled, so EHS should apply.");
    reasons.push("Cashless treatment avoids paying first and claiming later.");
    documents.push("EHS health card", "Referral from the EHS medical officer if required");
  } else if (hospital === "government") {
    route = "either";
    reasons.push("Treatment in a government hospital is admissible under either route.");
    documents.push("Essentiality certificate from the treating government doctor");
  } else if (treatment === "emergency") {
    // Emergencies are the recognised exception to prior permission.
    route = "medical-reimbursement";
    reasons.push("Emergency treatment is generally admissible even without prior permission.");
    reasons.push("The emergency must be certified by the treating doctor.");
    documents.push("Emergency certificate from the treating doctor");
  } else if (hospital === "private-non-empanelled" && !hadPriorPermission && alreadyTreated) {
    // The most common rejection: private, non-empanelled, no permission.
    route = "unlikely-to-be-payable";
    reasons.push(
      "Treatment already taken in a non-empanelled private hospital without prior permission is the most commonly rejected category.",
    );
    reasons.push("Ex post facto sanction is sometimes granted; it is discretionary, not a right.");
    documents.push("Application for ex post facto sanction with justification");
  } else if (treatment === "outpatient") {
    route = "medical-reimbursement";
    reasons.push("Outpatient treatment is normally outside EHS cashless cover.");
    reasons.push("Reimbursement limits for outpatient treatment are restrictive.");
  } else {
    route = "medical-reimbursement";
    reasons.push("Reimbursement is the likely route on these facts.");
    if (hadPriorPermission) reasons.push("Prior permission strengthens the claim considerably.");
  }

  const suggestedQuestion =
    route === "ehs"
      ? "What does EHS cover for inpatient treatment at an empanelled hospital, and what is the referral procedure?"
      : `Under the AP Medical Attendance Rules, is ${treatment} treatment at a ${hospital.replace(/-/g, " ")} hospital reimbursable${hadPriorPermission ? " with prior permission" : " without prior permission"}?`;

  return { route, reasons, documents, suggestedQuestion, isGuidanceOnly: true };
}

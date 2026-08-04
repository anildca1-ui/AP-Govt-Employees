export { roundRupees, formatINR, type Rupees } from "./money.js";

export {
  rateOn,
  ratesOfKind,
  rateCitation,
  formatGoDate,
  RateNotFoundError,
  type RateKind,
  type RateRow,
  type RateSource,
  type ResolvedRate,
} from "./rates.js";

// The 13 calculators of PLAN.md Part 4.
export {
  calculateDaArrears,
  monthsBetween,
  InvalidPeriodError,
  type DaArrearsInput,
  type DaArrearsMonth,
  type DaArrearsResult,
} from "./da-arrears.js";

export {
  calculateIncrement,
  calculateFixation,
  nextStage,
  stageIndex,
  OffScaleError,
  type FixationInput,
  type FixationResult,
  type IncrementResult,
  type MasterScalePayload,
} from "./pay-scale.js";

export {
  calculateSalary,
  InvalidSalaryInputError,
  type HraPayload,
  type HraSlab,
  type SalaryInput,
  type SalaryResult,
} from "./salary.js";

export {
  projectNps,
  estimateGps,
  calculateOpsPension,
  calculateGratuity,
  calculateLeaveEncashment,
  calculateGpf,
  calculateRetirement,
  InvalidInputError,
  type GpfInput,
  type GpfResult,
  type GpsInput,
  type GpsResult,
  type GratuityInput,
  type GratuityResult,
  type LeaveEncashmentInput,
  type LeaveEncashmentResult,
  type NpsInput,
  type NpsResult,
  type OpsPensionInput,
  type OpsPensionResult,
  type RetirementInput,
  type RetirementResult,
} from "./retirement.js";

export {
  calculateTax,
  compareRegimes,
  taxBySlabs,
  InvalidTaxInputError,
  type RegimeComparison,
  type TaxInput,
  type TaxRegimePayload,
  type TaxResult,
  type TaxSlab,
} from "./income-tax.js";

export {
  calculateApgli,
  premiumForBasic,
  NoApgliSlabError,
  type ApgliInput,
  type ApgliResult,
  type ApgliSlab,
} from "./apgli.js";

export {
  assessMedicalClaim,
  type HospitalKind,
  type MedicalGuidance,
  type MedicalInput,
  type MedicalRoute,
  type TreatmentType,
} from "./medical.js";

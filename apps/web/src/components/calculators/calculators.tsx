"use client";

import {
  calculateApgli,
  calculateDaArrears,
  calculateFixation,
  calculateGpf,
  calculateGratuity,
  calculateIncrement,
  calculateLeaveEncashment,
  calculateOpsPension,
  calculateRetirement,
  calculateSalary,
  compareRegimes,
  estimateGps,
  formatINR,
  projectNps,
  rateOn,
  assessMedicalClaim,
  type MasterScalePayload,
  type TaxRegimePayload,
} from "@ap-emp-ai/calc";
import { CalculatorShell, type CalcField, type CalcOutcome } from "./calculator-shell";
import { ratesFor } from "@/lib/calculators/rates-data";
import type { CalculatorId } from "@/lib/calculators/registry";
import type { Dictionary } from "@/i18n/dictionary";

/**
 * The thirteen calculator bodies.
 *
 * Each is a thin adapter: parse form strings, call the pure function from
 * packages/calc, render. No arithmetic happens here — the rules and their tests
 * live in the package, and duplicating any of it in a component is how the two
 * start to disagree.
 */

const num = (values: Record<string, string>, key: string, fallback = 0): number => {
  const parsed = Number(values[key]);
  return Number.isFinite(parsed) ? parsed : fallback;
};

function Rows({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-slate-600">{label}</dt>
          <dd className="text-right font-medium tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

type Builder = (dict: Dictionary) => {
  fields: CalcField[];
  compute: (values: Record<string, string>) => CalcOutcome;
};

/**
 * Field and result labels for the calculators.
 *
 * These were hardcoded English for eleven of the thirteen, so a Telugu reader
 * saw "Taxable income" and "Monthly pension" on a Telugu-first page — the one
 * promise this portal makes to the people it is for (CLAUDE.md rule 5).
 */
const L = (dict: Dictionary) => dict.calculators.labels;

/**
 * Labels one line of the salary breakdown in the reader's language.
 *
 * calculateSalary returns a language-neutral `key` plus an English `label`; the
 * percentage is re-attached here so "DA @ 37.31%" reads as "డీఏ @ 37.31%"
 * rather than being translated into a fixed string that loses the rate.
 */
function breakdownLabel(
  dict: Dictionary,
  row: { key: string; label: string; percent?: number },
): string {
  const labels = L(dict);
  if (row.key === "basicPay") return labels.basicPay;
  if (row.key === "cca") return labels.cca;
  if (row.key === "da" || row.key === "hra") {
    const name = row.key === "da" ? labels.da : labels.hra;
    return row.percent === undefined ? name : `${name} @ ${row.percent}%`;
  }
  // Deduction rows carry the component's own name (GPF, APGLI, GIS, PT), which
  // is an abbreviation used as-is in Telugu — only the minus sign is ours.
  if (row.key.startsWith("deduction:")) return `− ${row.key.slice("deduction:".length)}`;
  return row.label;
}

const BUILDERS: Record<CalculatorId, Builder> = {
  "da-arrears": (dict) => ({
    fields: [
      { name: "basicPay", label: dict.calculators.basicPay, defaultValue: "52590", required: true },
      { name: "fromMonth", label: dict.calculators.fromMonth, type: "month", defaultValue: "2024-01" },
      { name: "toMonth", label: dict.calculators.toMonth, type: "month", defaultValue: "2025-09" },
      { name: "paidDa", label: dict.calculators.paidDa, defaultValue: "33.67", step: "0.01" },
      { name: "cashFraction", label: dict.calculators.cashFraction, defaultValue: "1", step: "0.01" },
    ],
    compute: (v) => {
      const result = calculateDaArrears(
        {
          basicPay: num(v, "basicPay"),
          fromMonth: v.fromMonth ?? "",
          toMonth: v.toMonth ?? "",
          paidDaPercent: num(v, "paidDa"),
          cashFraction: num(v, "cashFraction", 1),
        },
        ratesFor<{ percent: number }>("DA"),
      );

      return {
        body: (
          <div className="space-y-3">
            <Rows
              rows={[
                [dict.calculators.total, formatINR(result.total)],
                [dict.calculators.cash, formatINR(result.cash)],
                [dict.calculators.gpfCps, formatINR(result.gpfOrCps)],
              ]}
            />
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="py-1">{dict.calculators.month}</th>
                    <th className="py-1 text-right">DA %</th>
                    <th className="py-1 text-right">{dict.calculators.difference}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.months.map((month) => (
                    <tr key={month.month} className="border-t border-slate-100">
                      <td className="py-1">{month.month}</td>
                      <td className="py-1 text-right tabular-nums">{month.dueDaPercent}</td>
                      <td className="py-1 text-right tabular-nums">{formatINR(month.difference)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ),
        shareText: `${dict.calculators.total}: ${formatINR(result.total)} (${result.months.length} months)`,
        sourceGos: result.sourceGos,
        unverified: result.unverified,
        // A total with no timing reads as money arriving shortly. DA orders
        // frequently defer arrears to retirement or route them to GPF instead,
        // and this figure is the one people forward to each other.
        note: dict.calculators.payoutTimingNote,
      };
    },
  }),

  salary: (dict) => ({
    fields: [
      { name: "basicPay", label: dict.calculators.basicPay, defaultValue: "52590", required: true },
      { name: "hraPercent", label: dict.calculators.hraPercent, defaultValue: "16", step: "0.01" },
      { name: "cca", label: L(dict).cca, defaultValue: "0" },
      { name: "pf", label: L(dict).gpfCps, defaultValue: "0" },
      { name: "apgli", label: L(dict).apgli, defaultValue: "0" },
      { name: "gis", label: L(dict).gis, defaultValue: "0" },
      { name: "pt", label: L(dict).pt, defaultValue: "0" },
    ],
    compute: (v) => {
      const result = calculateSalary(
        {
          basicPay: num(v, "basicPay"),
          hraPercent: num(v, "hraPercent"),
          cca: num(v, "cca"),
          deductions: {
            providentFund: num(v, "pf"),
            apgli: num(v, "apgli"),
            gis: num(v, "gis"),
            professionalTax: num(v, "pt"),
          },
        },
        ratesFor<{ percent: number }>("DA").concat(ratesFor<{ percent: number }>("HRA")),
      );

      // Earnings, then gross, then deductions, then net — the order a pay slip
      // is read in. Gross used to be missing from the page entirely while the
      // WhatsApp share quoted it, so a reader forwarded a figure they had never
      // been shown and could not check. A row of em-dashes stood where it
      // belongs, which in a table of amounts reads as missing data.
      const isDeduction = (row: { key: string }) => row.key.startsWith("deduction:");
      const line = (row: { key: string; label: string; percent?: number; amount: number }) =>
        [breakdownLabel(dict, row), formatINR(row.amount)] as [string, string];

      return {
        body: (
          <Rows
            rows={[
              ...result.breakdown.filter((row) => !isDeduction(row)).map(line),
              [L(dict).gross, formatINR(result.gross)],
              ...result.breakdown.filter(isDeduction).map(line),
              [L(dict).net, formatINR(result.net)],
            ]}
          />
        ),
        shareText: `Gross ${formatINR(result.gross)} · Net ${formatINR(result.net)}`,
        sourceGos: result.sourceGos,
        unverified: result.unverified,
      };
    },
  }),

  increment: (dict) => ({
    fields: [
      { name: "basicPay", label: dict.calculators.basicPay, defaultValue: "20000", required: true },
    ],
    compute: (v) => {
      const result = calculateIncrement(num(v, "basicPay"), ratesFor<MasterScalePayload>("MASTER_SCALE"));
      return {
        body: (
          <Rows
            rows={[
              [L(dict).presentBasic, formatINR(result.currentBasic)],
              [L(dict).afterIncrement, formatINR(result.newBasic)],
              [L(dict).increment, formatINR(result.incrementAmount)],
            ]}
          />
        ),
        shareText: `${formatINR(result.currentBasic)} → ${formatINR(result.newBasic)}`,
        sourceGos: result.sourceGo === null ? [] : [result.sourceGo],
        unverified: result.unverified,
      };
    },
  }),

  fixation: (dict) => ({
    fields: [
      { name: "basicPay", label: dict.calculators.basicPay, defaultValue: "20000", required: true },
      // The AAS scheme itself is not encoded (TASKS.md BLOCKED): the thresholds
      // that say which service length earns which grade need the governing GO.
      // Saying so beside the field is the difference between a calculator that
      // is honest about its limits and one that looks broken.
      {
        name: "promotionMin",
        label: L(dict).promotionMin,
        defaultValue: "",
        help: L(dict).promotionMinHelp,
      },
      {
        name: "notional",
        label: L(dict).notionalIncrement,
        type: "select",
        defaultValue: "yes",
        options: [
          { value: "yes", label: L(dict).yes },
          { value: "no", label: L(dict).no },
        ],
      },
    ],
    compute: (v) => {
      const min = v.promotionMin === "" ? undefined : num(v, "promotionMin");
      const result = calculateFixation(
        {
          currentBasic: num(v, "basicPay"),
          ...(min !== undefined && { promotionScaleMinimum: min }),
          withNotionalIncrement: v.notional !== "no",
        },
        ratesFor<MasterScalePayload>("MASTER_SCALE"),
      );

      return {
        body: (
          <div className="space-y-2">
            <Rows rows={[[L(dict).fixedAt, formatINR(result.fixedBasic)]]} />
            <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
              {result.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
        ),
        shareText: `Fixed at ${formatINR(result.fixedBasic)}`,
        sourceGos: result.sourceGo === null ? [] : [result.sourceGo],
        unverified: result.unverified,
      };
    },
  }),

  nps: (dict) => ({
    fields: [
      { name: "basicPay", label: dict.calculators.basicPay, defaultValue: "52590", required: true },
      { name: "years", label: L(dict).yearsToRetire, defaultValue: "20" },
      { name: "returnPct", label: L(dict).expectedReturn, defaultValue: "8", step: "0.1" },
      { name: "growthPct", label: L(dict).payGrowth, defaultValue: "3", step: "0.1" },
    ],
    compute: (v) => {
      const da = rateOn(ratesFor<{ percent: number }>("DA"), "DA", today());
      const nps = rateOn(
        ratesFor<{ employee_percent: number; government_percent: number }>("NPS"),
        "NPS",
        today(),
      );

      const result = projectNps({
        basicPay: num(v, "basicPay"),
        daPercent: da.payload.percent,
        employeePercent: nps.payload.employee_percent,
        governmentPercent: nps.payload.government_percent,
        yearsToRetirement: num(v, "years"),
        annualReturnPercent: num(v, "returnPct"),
        annualIncrementPercent: num(v, "growthPct"),
      });

      return {
        body: (
          <Rows
            rows={[
              [L(dict).employeePerMonth, formatINR(result.monthlyEmployee)],
              [L(dict).govtPerMonth, formatINR(result.monthlyGovernment)],
              [L(dict).totalContributed, formatINR(result.totalContributed)],
              [L(dict).growth, formatINR(result.growth)],
              [L(dict).projectedCorpus, formatINR(result.projectedCorpus)],
            ]}
          />
        ),
        shareText: `Projected corpus ${formatINR(result.projectedCorpus)}`,
        sourceGos: [da.source?.go_number, nps.source?.go_number].filter(
          (go): go is string => typeof go === "string",
        ),
        unverified: da.unverified || nps.unverified,
      };
    },
  }),

  gps: (dict) => ({
    fields: [
      { name: "lastBasic", label: L(dict).lastBasicPay, defaultValue: "100000", required: true },
      { name: "assured", label: L(dict).assuredPct, defaultValue: "50", step: "0.1" },
      { name: "corpus", label: L(dict).cpsCorpus, defaultValue: "" },
      { name: "annuity", label: L(dict).annuityRate, defaultValue: "6", step: "0.1" },
    ],
    compute: (v) => {
      const corpus = v.corpus === "" ? undefined : num(v, "corpus");
      const result = estimateGps({
        lastBasicPay: num(v, "lastBasic"),
        assuredPercent: num(v, "assured"),
        ...(corpus !== undefined && { cpsCorpus: corpus, annuityRatePercent: num(v, "annuity") }),
      });

      return {
        body: (
          <Rows
            rows={[
              [L(dict).gpsAssured, formatINR(result.assuredMonthlyPension)],
              ...(result.cpsMonthlyPension === null
                ? []
                : ([
                    [L(dict).cpsAnnuity, formatINR(result.cpsMonthlyPension)],
                    [L(dict).difference, formatINR(result.difference ?? 0)],
                  ] as [string, string][])),
            ]}
          />
        ),
        shareText: `GPS assured pension ${formatINR(result.assuredMonthlyPension)} (estimate)`,
        sourceGos: [],
        // The GPS Act is not in the corpus yet, so this is explicitly an estimate.
        unverified: true,
      };
    },
  }),

  "ops-pension": (dict) => ({
    fields: [
      { name: "lastPay", label: L(dict).lastPay, defaultValue: "100000", required: true },
      { name: "years", label: L(dict).qualifyingService, defaultValue: "25" },
      { name: "fullYears", label: L(dict).yearsFullPension, defaultValue: "20" },
      { name: "pensionPct", label: L(dict).pensionPctOfPay, defaultValue: "50", step: "0.1" },
      { name: "commutePct", label: L(dict).commutePct, defaultValue: "" },
      { name: "factor", label: L(dict).commuteFactor, defaultValue: "", step: "0.01" },
    ],
    compute: (v) => {
      const commutePct = v.commutePct === "" ? undefined : num(v, "commutePct");
      const factor = v.factor === "" ? undefined : num(v, "factor");
      const result = calculateOpsPension({
        lastPay: num(v, "lastPay"),
        qualifyingYears: num(v, "years"),
        fullPensionYears: num(v, "fullYears"),
        pensionPercent: num(v, "pensionPct"),
        ...(commutePct !== undefined && { maxCommutationPercent: commutePct }),
        ...(factor !== undefined && { commutationFactor: factor }),
      });

      return {
        body: (
          <Rows
            rows={[
              [L(dict).monthlyPension, formatINR(result.monthlyPension)],
              ...(result.commutedLumpSum === null
                ? []
                : ([
                    [L(dict).commutedLumpSum, formatINR(result.commutedLumpSum)],
                    [L(dict).residualPension, formatINR(result.residualPension ?? 0)],
                  ] as [string, string][])),
            ]}
          />
        ),
        shareText: `Monthly pension ${formatINR(result.monthlyPension)}`,
        sourceGos: [],
        unverified: true,
      };
    },
  }),

  gratuity: (dict) => ({
    fields: [
      { name: "lastBasic", label: L(dict).lastBasicPay, defaultValue: "100000", required: true },
      { name: "years", label: L(dict).qualifyingService, defaultValue: "33" },
      { name: "ceiling", label: L(dict).ceiling, defaultValue: "" },
    ],
    compute: (v) => {
      const da = rateOn(ratesFor<{ percent: number }>("DA"), "DA", today());
      const ceiling = v.ceiling === "" ? undefined : num(v, "ceiling");
      const result = calculateGratuity({
        lastBasicPay: num(v, "lastBasic"),
        daPercent: da.payload.percent,
        qualifyingYears: num(v, "years"),
        ...(ceiling !== undefined && { ceiling }),
      });

      return {
        body: (
          <Rows
            rows={[
              // With paise: the total is computed from this exact figure, and a
              // reader multiplying a rounded one finds rupees missing.
              [L(dict).emoluments, formatINR(result.emoluments, { paise: true })],
              [L(dict).halfMonthsEarned, String(result.halfMonthsEarned)],
              [dict.calculators.total, formatINR(result.payable)],
            ]}
          />
        ),
        shareText: `Gratuity ${formatINR(result.payable)}`,
        sourceGos: da.source?.go_number ? [da.source.go_number] : [],
        unverified: da.unverified,
      };
    },
  }),

  "leave-encashment": (dict) => ({
    fields: [
      { name: "basicPay", label: dict.calculators.basicPay, defaultValue: "100000", required: true },
      { name: "days", label: L(dict).days, defaultValue: "300" },
      { name: "maxDays", label: L(dict).maxDays, defaultValue: "300" },
    ],
    compute: (v) => {
      const da = rateOn(ratesFor<{ percent: number }>("DA"), "DA", today());
      const maxDays = v.maxDays === "" ? undefined : num(v, "maxDays");
      const result = calculateLeaveEncashment({
        basicPay: num(v, "basicPay"),
        daPercent: da.payload.percent,
        days: num(v, "days"),
        ...(maxDays !== undefined && { maxDays }),
      });

      return {
        body: (
          <Rows
            rows={[
              // Emoluments, not the per-day rate. Leave salary is emoluments ×
              // days / 30, so this is the figure a reader can multiply back to
              // the total — a per-day rate cannot be written at currency
              // precision and still reconcile over 300 days.
              [L(dict).emoluments, formatINR(result.emoluments, { paise: true })],
              [L(dict).daysPaid, String(result.daysPaid)],
              [dict.calculators.total, formatINR(result.amount)],
            ]}
          />
        ),
        shareText: `Leave encashment ${formatINR(result.amount)} for ${result.daysPaid} days`,
        sourceGos: da.source?.go_number ? [da.source.go_number] : [],
        unverified: da.unverified,
      };
    },
  }),

  "income-tax": (dict) => ({
    fields: [
      {
        name: "fy",
        label: L(dict).financialYear,
        type: "select",
        defaultValue: latestTaxYear()?.value ?? "",
        options: taxYearOptions(),
      },
      { name: "gross", label: L(dict).grossAnnual, defaultValue: "1200000", required: true },
      { name: "s80c", label: L(dict).s80c, defaultValue: "150000" },
      { name: "s80d", label: L(dict).s80d, defaultValue: "25000" },
      { name: "hra", label: L(dict).hraExempt, defaultValue: "0" },
    ],
    compute: (v) => {
      // Chosen by financial year, not by today's date. Tax is computed FOR a
      // year — and keying off today breaks the calculator outright the moment
      // the seeded year ends, which is exactly what happened: the FY2025-26
      // row lapsed on 31.03.2026 and the page then had no rate at all.
      const chosen = v.fy ?? latestTaxYear()?.value ?? "";
      const row = ratesFor<TaxRegimePayload>("IT_SLAB").find(
        (r) => (r.payload as unknown as { fy?: string }).fy === chosen,
      );
      if (row === undefined) {
        throw new Error(
          `No income-tax slabs are seeded for ${chosen || "any year"}. ` +
            `Slabs come from the rates table (CLAUDE.md rule 1) — seed and verify the year first.`,
        );
      }

      const newRegime = {
        source: row.payload._source_go ?? null,
        unverified: row.payload._unverified === true,
      };
      const payload = row.payload as unknown as {
        regime: "new";
        fy: string;
        slabs: TaxRegimePayload["slabs"];
        standard_deduction: number;
        rebate_87a_upto: number;
        cess_percent: number;
      };

      const asRegime: TaxRegimePayload = {
        regime: "new",
        fy: payload.fy,
        slabs: payload.slabs,
        standardDeduction: payload.standard_deduction,
        rebate87aUpto: payload.rebate_87a_upto,
        cessPercent: payload.cess_percent,
      };

      // Only the new regime is seeded so far. Comparing against a regime we do
      // not have would mean inventing slabs, so until the old-regime row is
      // seeded and verified this reports the new regime alone.
      const result = compareRegimes(
        {
          grossSalary: num(v, "gross"),
          deductions: {
            section80c: num(v, "s80c"),
            section80d: num(v, "s80d"),
            hraExemption: num(v, "hra"),
          },
        },
        asRegime,
        asRegime,
      );

      return {
        body: (
          <Rows
            rows={[
              [L(dict).taxableIncome, formatINR(result.new.taxableIncome)],
              [L(dict).taxOnSlabs, formatINR(result.new.slabTax)],
              [L(dict).rebate87a, formatINR(result.new.rebate)],
              [L(dict).cess, formatINR(result.new.cess)],
              [L(dict).totalTax, formatINR(result.new.totalTax)],
            ]}
          />
        ),
        shareText: `Total tax ${formatINR(result.new.totalTax)} (${asRegime.fy}, new regime)`,
        sourceGos: newRegime.source?.go_number ? [newRegime.source.go_number] : [],
        unverified: newRegime.unverified,
      };
    },
  }),

  "apgli-gpf": (dict) => ({
    fields: [
      { name: "basicPay", label: L(dict).basicPay, defaultValue: "52590", required: true },
      { name: "premium", label: L(dict).apgliPremium, defaultValue: "1000" },
      { name: "opening", label: L(dict).gpfOpening, defaultValue: "500000" },
      { name: "subscription", label: L(dict).gpfSubscription, defaultValue: "10000" },
      { name: "gpfRate", label: L(dict).gpfRate, defaultValue: "7.1", step: "0.01" },
    ],
    compute: (v) => {
      // The APGLI slab table is not seeded yet, so the premium is an input
      // rather than a lookup — better than inventing a slab table.
      const apgli = calculateApgli({
        basicPay: num(v, "basicPay"),
        slabs: [{ fromBasic: 0, premium: num(v, "premium") }],
      });
      const gpf = calculateGpf({
        openingBalance: num(v, "opening"),
        monthlySubscription: num(v, "subscription"),
        annualRatePercent: num(v, "gpfRate"),
      });

      return {
        body: (
          <Rows
            rows={[
              [L(dict).apgliMonthly, formatINR(apgli.monthlyPremium)],
              [L(dict).apgliAnnual, formatINR(apgli.annualPremium)],
              [L(dict).gpfInterest, formatINR(gpf.interest)],
              [L(dict).gpfClosing, formatINR(gpf.closingBalance)],
            ]}
          />
        ),
        shareText: `GPF closing ${formatINR(gpf.closingBalance)}, APGLI ${formatINR(apgli.monthlyPremium)}/month`,
        sourceGos: [],
        unverified: true,
      };
    },
  }),

  retirement: (dict) => ({
    fields: [
      { name: "dob", label: L(dict).dob, type: "date", defaultValue: "1970-06-15", required: true },
      { name: "doj", label: L(dict).doj, type: "date", defaultValue: "1995-08-01", required: true },
      { name: "age", label: L(dict).retirementAge, defaultValue: "60" },
    ],
    compute: (v) => {
      const result = calculateRetirement({
        dateOfBirth: v.dob ?? "",
        dateOfJoining: v.doj ?? "",
        retirementAge: num(v, "age", 60),
      });

      return {
        body: (
          <Rows
            rows={[
              [L(dict).retirementDate, result.retirementDate],
              [L(dict).totalService, String(result.totalServiceYears)],
              [L(dict).completedService, String(result.completedServiceYears)],
              [L(dict).daysRemaining, String(result.remainingDays)],
            ]}
          />
        ),
        shareText: `Retirement on ${result.retirementDate}, ${result.remainingDays} days to go`,
        sourceGos: [],
        unverified: false,
      };
    },
  }),

  medical: (dict) => ({
    fields: [
      {
        name: "enrolled",
        label: L(dict).ehsEnrolled,
        type: "select",
        defaultValue: "yes",
        options: [
          { value: "yes", label: L(dict).yes },
          { value: "no", label: L(dict).no },
        ],
      },
      {
        name: "treatment",
        label: L(dict).treatment,
        type: "select",
        defaultValue: "inpatient",
        options: [
          { value: "inpatient", label: L(dict).inpatient },
          { value: "outpatient", label: L(dict).outpatient },
          { value: "emergency", label: L(dict).emergency },
          { value: "diagnostic", label: L(dict).diagnostic },
        ],
      },
      {
        name: "hospital",
        label: L(dict).hospital,
        type: "select",
        defaultValue: "ehs-empanelled",
        options: [
          { value: "ehs-empanelled", label: L(dict).ehsEmpanelled },
          { value: "government", label: L(dict).government },
          { value: "private-non-empanelled", label: L(dict).privateNotEmpanelled },
        ],
      },
      {
        name: "permission",
        label: L(dict).priorPermission,
        type: "select",
        defaultValue: "no",
        options: [
          { value: "no", label: L(dict).no },
          { value: "yes", label: L(dict).yes },
        ],
      },
    ],
    compute: (v) => {
      const guidance = assessMedicalClaim({
        isEhsEnrolled: v.enrolled === "yes",
        treatment: (v.treatment ?? "inpatient") as "inpatient",
        hospital: (v.hospital ?? "ehs-empanelled") as "ehs-empanelled",
        alreadyTreated: true,
        hadPriorPermission: v.permission === "yes",
      });

      return {
        body: (
          <div className="space-y-3 text-sm">
            <p className="font-medium">{guidance.route.replace(/-/g, " ")}</p>
            <ul className="list-disc space-y-1 pl-5 text-slate-600">
              {guidance.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            <div>
              <p className="font-medium">Documents</p>
              <ul className="list-disc space-y-1 pl-5 text-slate-600">
                {guidance.documents.map((doc) => (
                  <li key={doc}>{doc}</li>
                ))}
              </ul>
            </div>
            {/* Guidance only — the entitlement itself must come from a GO. */}
            <p className="rounded bg-slate-100 p-2 text-xs text-slate-600">
              {guidance.suggestedQuestion}
            </p>
          </div>
        ),
        shareText: guidance.suggestedQuestion,
        sourceGos: [],
        unverified: true,
      };
    },
  }),
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Financial years that actually have seeded slabs, newest first. */
function taxYearOptions(): { value: string; label: string }[] {
  return ratesFor<{ fy?: string }>("IT_SLAB")
    .map((row) => (row.payload as { fy?: string }).fy)
    .filter((fy): fy is string => typeof fy === "string")
    .sort((a, b) => b.localeCompare(a))
    .map((fy) => ({ value: fy, label: fy }));
}

function latestTaxYear(): { value: string; label: string } | undefined {
  return taxYearOptions()[0];
}

export function Calculator({
  id,
  title,
  description,
  dict,
}: {
  id: CalculatorId;
  title: string;
  description: string;
  dict: Dictionary;
}) {
  const { fields, compute } = BUILDERS[id](dict);

  return (
    <CalculatorShell
      title={title}
      description={description}
      fields={fields}
      dict={dict}
      compute={compute}
    />
  );
}

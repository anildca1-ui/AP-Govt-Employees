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
      { name: "cca", label: "CCA", defaultValue: "0" },
      { name: "pf", label: "GPF / CPS", defaultValue: "0" },
      { name: "apgli", label: "APGLI", defaultValue: "0" },
      { name: "gis", label: "GIS", defaultValue: "0" },
      { name: "pt", label: "PT", defaultValue: "0" },
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

      return {
        body: (
          <Rows
            rows={[
              ...result.breakdown.map(
                (row) => [row.label, formatINR(row.amount)] as [string, string],
              ),
              ["—", "—"],
              ["Net", formatINR(result.net)],
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
              ["Present basic", formatINR(result.currentBasic)],
              ["After increment", formatINR(result.newBasic)],
              ["Increment", formatINR(result.incrementAmount)],
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
      { name: "promotionMin", label: "Promotion scale minimum", defaultValue: "" },
      {
        name: "notional",
        label: "Notional increment",
        type: "select",
        defaultValue: "yes",
        options: [
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
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
            <Rows rows={[["Fixed at", formatINR(result.fixedBasic)]]} />
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
      { name: "years", label: "Years to retirement", defaultValue: "20" },
      { name: "returnPct", label: "Expected return %", defaultValue: "8", step: "0.1" },
      { name: "growthPct", label: "Annual pay growth %", defaultValue: "3", step: "0.1" },
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
              ["Employee / month", formatINR(result.monthlyEmployee)],
              ["Government / month", formatINR(result.monthlyGovernment)],
              ["Total contributed", formatINR(result.totalContributed)],
              ["Growth", formatINR(result.growth)],
              ["Projected corpus", formatINR(result.projectedCorpus)],
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

  gps: () => ({
    fields: [
      { name: "lastBasic", label: "Last basic pay", defaultValue: "100000", required: true },
      { name: "assured", label: "Assured %", defaultValue: "50", step: "0.1" },
      { name: "corpus", label: "CPS corpus (optional)", defaultValue: "" },
      { name: "annuity", label: "Annuity rate %", defaultValue: "6", step: "0.1" },
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
              ["GPS assured pension", formatINR(result.assuredMonthlyPension)],
              ...(result.cpsMonthlyPension === null
                ? []
                : ([
                    ["CPS annuity estimate", formatINR(result.cpsMonthlyPension)],
                    ["Difference", formatINR(result.difference ?? 0)],
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

  "ops-pension": () => ({
    fields: [
      { name: "lastPay", label: "Last pay", defaultValue: "100000", required: true },
      { name: "years", label: "Qualifying service (years)", defaultValue: "25" },
      { name: "fullYears", label: "Years for full pension", defaultValue: "20" },
      { name: "pensionPct", label: "Pension % of last pay", defaultValue: "50", step: "0.1" },
      { name: "commutePct", label: "Commutation % (optional)", defaultValue: "" },
      { name: "factor", label: "Commutation factor (optional)", defaultValue: "", step: "0.01" },
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
              ["Monthly pension", formatINR(result.monthlyPension)],
              ...(result.commutedLumpSum === null
                ? []
                : ([
                    ["Commuted lump sum", formatINR(result.commutedLumpSum)],
                    ["Residual pension", formatINR(result.residualPension ?? 0)],
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
      { name: "lastBasic", label: "Last basic pay", defaultValue: "100000", required: true },
      { name: "years", label: "Qualifying service (years)", defaultValue: "33" },
      { name: "ceiling", label: "Ceiling (optional)", defaultValue: "" },
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
              ["Emoluments (basic + DA)", formatINR(result.emoluments)],
              ["Half-months earned", String(result.halfMonthsEarned)],
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
      { name: "days", label: "Days", defaultValue: "300" },
      { name: "maxDays", label: "Maximum days (optional)", defaultValue: "300" },
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
              ["Per day", formatINR(result.perDay)],
              ["Days paid", String(result.daysPaid)],
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

  "income-tax": () => ({
    fields: [
      {
        name: "fy",
        label: "Financial year",
        type: "select",
        defaultValue: latestTaxYear()?.value ?? "",
        options: taxYearOptions(),
      },
      { name: "gross", label: "Gross annual salary", defaultValue: "1200000", required: true },
      { name: "s80c", label: "80C (old regime)", defaultValue: "150000" },
      { name: "s80d", label: "80D (old regime)", defaultValue: "25000" },
      { name: "hra", label: "HRA exemption (old regime)", defaultValue: "0" },
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
              ["Taxable income", formatINR(result.new.taxableIncome)],
              ["Tax on slabs", formatINR(result.new.slabTax)],
              ["Rebate 87A", formatINR(result.new.rebate)],
              ["Cess", formatINR(result.new.cess)],
              ["Total tax", formatINR(result.new.totalTax)],
            ]}
          />
        ),
        shareText: `Total tax ${formatINR(result.new.totalTax)} (${asRegime.fy}, new regime)`,
        sourceGos: newRegime.source?.go_number ? [newRegime.source.go_number] : [],
        unverified: newRegime.unverified,
      };
    },
  }),

  "apgli-gpf": () => ({
    fields: [
      { name: "basicPay", label: "Basic pay", defaultValue: "52590", required: true },
      { name: "premium", label: "APGLI premium (from your slab)", defaultValue: "1000" },
      { name: "opening", label: "GPF opening balance", defaultValue: "500000" },
      { name: "subscription", label: "GPF monthly subscription", defaultValue: "10000" },
      { name: "gpfRate", label: "GPF interest %", defaultValue: "7.1", step: "0.01" },
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
              ["APGLI monthly", formatINR(apgli.monthlyPremium)],
              ["APGLI annual", formatINR(apgli.annualPremium)],
              ["GPF interest (year)", formatINR(gpf.interest)],
              ["GPF closing balance", formatINR(gpf.closingBalance)],
            ]}
          />
        ),
        shareText: `GPF closing ${formatINR(gpf.closingBalance)}, APGLI ${formatINR(apgli.monthlyPremium)}/month`,
        sourceGos: [],
        unverified: true,
      };
    },
  }),

  retirement: () => ({
    fields: [
      { name: "dob", label: "Date of birth", type: "date", defaultValue: "1970-06-15", required: true },
      { name: "doj", label: "Date of joining", type: "date", defaultValue: "1995-08-01", required: true },
      { name: "age", label: "Retirement age", defaultValue: "60" },
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
              ["Retirement date", result.retirementDate],
              ["Total service (years)", String(result.totalServiceYears)],
              ["Completed (years)", String(result.completedServiceYears)],
              ["Days remaining", String(result.remainingDays)],
            ]}
          />
        ),
        shareText: `Retirement on ${result.retirementDate}, ${result.remainingDays} days to go`,
        sourceGos: [],
        unverified: false,
      };
    },
  }),

  medical: () => ({
    fields: [
      {
        name: "enrolled",
        label: "EHS enrolled",
        type: "select",
        defaultValue: "yes",
        options: [
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ],
      },
      {
        name: "treatment",
        label: "Treatment",
        type: "select",
        defaultValue: "inpatient",
        options: [
          { value: "inpatient", label: "Inpatient" },
          { value: "outpatient", label: "Outpatient" },
          { value: "emergency", label: "Emergency" },
          { value: "diagnostic", label: "Diagnostic" },
        ],
      },
      {
        name: "hospital",
        label: "Hospital",
        type: "select",
        defaultValue: "ehs-empanelled",
        options: [
          { value: "ehs-empanelled", label: "EHS empanelled" },
          { value: "government", label: "Government" },
          { value: "private-non-empanelled", label: "Private, not empanelled" },
        ],
      },
      {
        name: "permission",
        label: "Prior permission obtained",
        type: "select",
        defaultValue: "no",
        options: [
          { value: "no", label: "No" },
          { value: "yes", label: "Yes" },
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

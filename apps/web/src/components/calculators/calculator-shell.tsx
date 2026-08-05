"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState, type ReactNode } from "react";
import type { Dictionary } from "@/i18n/dictionary";

/**
 * The frame every calculator page shares: a form, a result panel, the source
 * line, the unverified warning, and share/print.
 *
 * Thirteen pages hand-rolling this would drift — and the parts most likely to
 * drift are the ones that must not: the "as per G.O…" citation and the warning
 * that a rate is unchecked.
 */

export interface CalcField {
  name: string;
  label: string;
  type?: "number" | "text" | "month" | "date" | "select";
  defaultValue?: string;
  options?: { value: string; label: string }[];
  step?: string;
  required?: boolean;
  help?: string;
}

export interface CalcOutcome {
  /** Rendered result. Null before the first calculation. */
  body: ReactNode;
  /** Plain-text summary for the WhatsApp share. */
  shareText: string;
  sourceGos: string[];
  unverified: boolean;
  /**
   * A caveat about the figure itself rather than about the rate behind it.
   * Separate from `unverified`, which is about our data: this is about what the
   * GO says happens next, and it stays true even once every rate is checked.
   */
  note?: string;
}

export interface CalculatorShellProps {
  title: string;
  description: string;
  fields: CalcField[];
  dict: Dictionary;
  /** Pure: values in, rendered outcome out. Throws are shown to the user. */
  compute: (values: Record<string, string>) => CalcOutcome;
}

/**
 * useSearchParams (for the dashboard's ?basicPay= prefill) makes the component
 * dynamic, and a statically prerendered page must wrap that in Suspense or the
 * whole build fails. The fallback renders nothing: the shell appears on
 * hydration, and these pages are client-computed anyway.
 */
export function CalculatorShell(props: CalculatorShellProps) {
  return (
    <Suspense fallback={null}>
      <CalculatorShellInner {...props} />
    </Suspense>
  );
}

function CalculatorShellInner({ title, description, fields, dict, compute }: CalculatorShellProps) {
  // The dashboard links here with the profile's values in the query string
  // (?basicPay=52590); a matching field name is prefilled. URL over context or
  // storage because it also makes any prefilled calculator shareable.
  const search = useSearchParams();
  const initial = useMemo(
    () =>
      Object.fromEntries(
        fields.map((f) => [f.name, search.get(f.name) ?? f.defaultValue ?? ""]),
      ),
    [fields, search],
  );
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [outcome, setOutcome] = useState<CalcOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run() {
    try {
      setOutcome(compute(values));
      setError(null);
    } catch (caught) {
      // Calculator errors are deliberately specific ("no DA rate is on record
      // for 2019-01"), so they are worth showing rather than swallowing.
      setOutcome(null);
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  const shareHref =
    outcome === null
      ? null
      : `https://wa.me/?text=${encodeURIComponent(`${title}\n\n${outcome.shareText}\n\n${dict.footer.disclaimer}`)}`;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-slate-600">{description}</p>
        <p className="text-xs text-slate-500">{dict.calculators.clientSide}</p>
      </header>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          run();
        }}
        className="space-y-3 rounded-lg border border-slate-200 p-4 print:hidden"
      >
        {fields.map((field) => (
          <label key={field.name} className="block text-sm">
            <span className="mb-1 block text-slate-700">{field.label}</span>
            {field.type === "select" ? (
              <select
                name={field.name}
                value={values[field.name] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
                className="w-full rounded-md border border-slate-300 px-3 py-2"
              >
                {(field.options ?? []).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={field.type ?? "number"}
                name={field.name}
                value={values[field.name] ?? ""}
                step={field.step}
                required={field.required}
                inputMode={field.type === undefined || field.type === "number" ? "decimal" : undefined}
                onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
                className="w-full rounded-md border border-slate-300 px-3 py-2"
              />
            )}
            {field.help !== undefined && (
              <span className="mt-1 block text-xs text-slate-500">{field.help}</span>
            )}
          </label>
        ))}

        <div className="flex gap-2">
          <button
            type="submit"
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          >
            {dict.calculators.calculate}
          </button>
          <button
            type="button"
            onClick={() => {
              setValues(initial);
              setOutcome(null);
              setError(null);
            }}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm"
          >
            {dict.calculators.reset}
          </button>
        </div>
      </form>

      {error !== null && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      {outcome !== null && (
        <section className="space-y-3 rounded-lg border border-slate-200 p-4">
          <h2 className="font-medium">{dict.calculators.result}</h2>
          {outcome.body}

          {/* Rule 1 reaches the calculators too: a figure has to name its GO. */}
          {outcome.sourceGos.length > 0 && (
            <p className="text-xs text-slate-500">
              {dict.calculators.asPer}: {outcome.sourceGos.join(", ")}
            </p>
          )}

          {outcome.unverified && (
            <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
              {dict.calculators.unverifiedWarning}
            </p>
          )}

          {outcome.note !== undefined && (
            <p className="rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
              {outcome.note}
            </p>
          )}

          <div className="flex gap-2 print:hidden">
            {shareHref !== null && (
              <a
                href={shareHref}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              >
                {dict.calculators.share}
              </a>
            )}
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            >
              {dict.calculators.print}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

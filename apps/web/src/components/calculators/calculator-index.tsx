"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CALCULATORS, labelsFor, searchCalculators } from "@/lib/calculators/registry";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionary";

/**
 * The calculators index with search.
 *
 * Thirteen tools is enough that scanning is slower than typing, and the search
 * matches the localised title and description so a Telugu speaker can find
 * "గ్రాట్యుటీ" without knowing the English name.
 */
export function CalculatorIndex({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [query, setQuery] = useState("");

  const matches = useMemo(() => searchCalculators(query, dict), [query, dict]);
  const featured = matches.filter((meta) => meta.featured === true);
  const rest = matches.filter((meta) => meta.featured !== true);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{dict.calculators.title}</h1>
        <p className="text-sm text-slate-600">{dict.calculators.intro}</p>
      </header>

      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={dict.calculators.searchPlaceholder}
        aria-label={dict.calculators.searchPlaceholder}
        className="w-full rounded-md border border-slate-300 px-3 py-2"
      />

      {matches.length === 0 ? (
        <p className="text-sm text-slate-500">{dict.calculators.noResults}</p>
      ) : (
        <>
          {featured.length > 0 && query.trim() === "" && (
            <Section title={dict.calculators.featured} items={featured} locale={locale} dict={dict} />
          )}
          <Section
            title={query.trim() === "" ? dict.calculators.all : dict.calculators.title}
            items={query.trim() === "" ? rest : matches}
            locale={locale}
            dict={dict}
          />
        </>
      )}

      <p className="text-xs text-slate-500">{dict.calculators.clientSide}</p>
    </div>
  );
}

function Section({
  title,
  items,
  locale,
  dict,
}: {
  title: string;
  items: typeof CALCULATORS;
  locale: Locale;
  dict: Dictionary;
}) {
  if (items.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium tracking-wide text-slate-500 uppercase">{title}</h2>
      <ul className="grid gap-3 sm:grid-cols-2">
        {items.map((meta) => {
          const { title: label, description } = labelsFor(meta, dict);
          return (
            <li key={meta.id}>
              <Link
                href={`/${locale}/calculators/${meta.slug}`}
                className="block h-full rounded-lg border border-slate-200 p-4 transition hover:border-slate-300"
              >
                <h3 className="font-medium">{label}</h3>
                <p className="mt-1 text-sm text-slate-600">{description}</p>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

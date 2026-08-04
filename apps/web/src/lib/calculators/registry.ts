import type { Dictionary } from "@/i18n/dictionary";

/**
 * The 13 calculators of PLAN.md Part 4, in one list.
 *
 * The index page, the search, the nav and the per-calculator pages all read
 * from here, so adding a calculator is one entry rather than four edits that
 * can disagree.
 */

export type CalculatorId =
  | "da-arrears"
  | "increment"
  | "fixation"
  | "salary"
  | "nps"
  | "gps"
  | "ops-pension"
  | "gratuity"
  | "leave-encashment"
  | "income-tax"
  | "apgli-gpf"
  | "retirement"
  | "medical";

export interface CalculatorMeta {
  id: CalculatorId;
  /** Key into dict.calculators.items — labels live in i18n (rule 5). */
  slug: string;
  /** Whether the calculation runs entirely in the browser. */
  clientOnly: boolean;
  /** Shown first on the index: the launch wedge (PLAN.md Part 6). */
  featured?: boolean;
}

export const CALCULATORS: CalculatorMeta[] = [
  { id: "da-arrears", slug: "da-arrears", clientOnly: true, featured: true },
  { id: "salary", slug: "salary", clientOnly: true, featured: true },
  { id: "increment", slug: "increment", clientOnly: true },
  { id: "fixation", slug: "fixation", clientOnly: true },
  { id: "nps", slug: "nps", clientOnly: true },
  { id: "gps", slug: "gps", clientOnly: true },
  { id: "ops-pension", slug: "ops-pension", clientOnly: true },
  { id: "gratuity", slug: "gratuity", clientOnly: true },
  { id: "leave-encashment", slug: "leave-encashment", clientOnly: true },
  { id: "income-tax", slug: "income-tax", clientOnly: true },
  { id: "apgli-gpf", slug: "apgli-gpf", clientOnly: true },
  { id: "retirement", slug: "retirement", clientOnly: true },
  // The only one that is not arithmetic: it narrows the question and hands it
  // to the chat so the answer arrives cited.
  { id: "medical", slug: "medical", clientOnly: true },
];

export interface CalculatorLabels {
  title: string;
  description: string;
}

export function labelsFor(meta: CalculatorMeta, dict: Dictionary): CalculatorLabels {
  const items = dict.calculators.items as Record<string, CalculatorLabels | undefined>;
  const entry = items[meta.slug];
  // Falling back to the slug keeps a missing translation visible rather than
  // rendering "undefined"; the dictionary parity test catches it in CI anyway.
  return entry ?? { title: meta.slug, description: "" };
}

/** Simple substring search over the localised title and description. */
export function searchCalculators(
  query: string,
  dict: Dictionary,
  list: CalculatorMeta[] = CALCULATORS,
): CalculatorMeta[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return list;

  return list.filter((meta) => {
    const { title, description } = labelsFor(meta, dict);
    return (
      title.toLowerCase().includes(needle) ||
      description.toLowerCase().includes(needle) ||
      meta.slug.includes(needle)
    );
  });
}

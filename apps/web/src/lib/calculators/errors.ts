/**
 * Turns a calculator's refusal into a sentence its reader can act on.
 *
 * The shell used to render `error.message` directly. Those messages are written
 * for a maintainer and several end with instructions to one — entering a month
 * outside the seeded DA timeline produced, on a Telugu page:
 *
 *     No DA rate is on record for 2017-01-01. Rates come from the rates table
 *     (CLAUDE.md rule 1); seed or verify the row before calculating.
 *
 * The refusal itself is right and worth showing: the calculator declines rather
 * than inventing a figure. Only the words were wrong. Each error now carries a
 * code and its particulars, so the reader keeps the specifics ("2017-01") in
 * their own language and loses the instructions meant for someone else.
 */
import { isCalcError } from "@ap-emp-ai/calc";
import type { Dictionary } from "@/i18n/dictionary";

function fill(template: string, params: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in params ? String(params[key]) : whole,
  );
}

export function calcErrorMessage(caught: unknown, dict: Dictionary): string {
  const errors = dict.calculators.errors;
  if (!isCalcError(caught)) return errors.generic;

  const template: string | undefined = {
    rateNotFound: errors.rateNotFound,
    offScale: errors.offScale,
    noApgliSlab: errors.noApgliSlab,
    badMonth: errors.badMonth,
    periodReversed: errors.periodReversed,
    joiningBeforeBirth: errors.joiningBeforeBirth,
    invalidInput: errors.generic,
  }[caught.code];

  // An unmapped code is a new error class with no sentence yet. Better a
  // general message than the maintainer's English.
  return template === undefined ? errors.generic : fill(template, caught.params);
}

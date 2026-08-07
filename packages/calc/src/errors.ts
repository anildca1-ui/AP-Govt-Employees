/**
 * The base for every error a calculator raises.
 *
 * `message` stays English and specific: it is what a failing test prints and
 * what a maintainer reads. It is not what the page shows. Several of these
 * messages ended with instructions to whoever runs the site — "seed or verify
 * the row before calculating", "(CLAUDE.md rule 1)" — and the calculator
 * rendered them verbatim, so a government employee entering a month outside the
 * seeded timeline was told to go and seed a database row, in English, on a
 * Telugu page.
 *
 * So each error also carries a `code` and the `params` that make it specific.
 * The UI picks a sentence by code and fills it from params, which keeps the
 * detail ("no DA rate on record for 2017-01") without the instructions and in
 * the reader's own language.
 */

export type CalcErrorCode =
  /** No rate row covers the date asked for. */
  | "rateNotFound"
  /** A pay that is not a stage of the master scale. */
  | "offScale"
  /** A basic pay outside every APGLI slab. */
  | "noApgliSlab"
  /** A month that is not yyyy-mm. */
  | "badMonth"
  /** The period runs backwards. */
  | "periodReversed"
  /** Joined before they were born. */
  | "joiningBeforeBirth"
  /**
   * A guard against a value the form should never submit (a negative basic
   * pay, a fraction outside 0..1). Reachable only by a bug or a crafted
   * request, so it earns a general message rather than its own sentence.
   */
  | "invalidInput";

export class CalcError extends Error {
  readonly code: CalcErrorCode;
  readonly params: Readonly<Record<string, string | number>>;

  constructor(
    code: CalcErrorCode,
    message: string,
    params: Record<string, string | number> = {},
  ) {
    super(message);
    this.code = code;
    this.params = params;
    // Set from the subclass rather than hardcoded, so each error still
    // identifies itself in a stack trace.
    this.name = new.target.name;
  }
}

/**
 * Narrows an unknown thrown value.
 *
 * Deliberately structural rather than `instanceof`: the web app and the calc
 * package are separate builds, and an instanceof check across a module boundary
 * fails silently when two copies are loaded — which would send every calculator
 * error to the generic message with nothing to show it had happened.
 */
export function isCalcError(value: unknown): value is CalcError {
  return (
    value instanceof Error &&
    typeof (value as CalcError).code === "string" &&
    typeof (value as CalcError).params === "object"
  );
}

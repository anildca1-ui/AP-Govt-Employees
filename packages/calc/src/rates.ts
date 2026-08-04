/**
 * Rate lookup shared by every calculator (CLAUDE.md rule 1).
 *
 * No calculator may hardcode a percentage. They all resolve rates through here,
 * so updating a DA GO updates every calculator at once — and so every result
 * can name the GO it was computed from.
 */

export type RateKind = "DA" | "HRA" | "IR" | "NPS" | "IT_SLAB" | "MASTER_SCALE" | "APGLI";

/** Provenance for a rate, as carried in payload._source_go by the seed. */
export interface RateSource {
  go_number: string | null;
  go_date: string | null;
  /** False until a human has checked the figure against the GO PDF. */
  verified: boolean;
  note?: string | null;
}

export interface RateRow<TPayload = Record<string, unknown>> {
  kind: RateKind;
  /** ISO yyyy-mm-dd. */
  effective_from: string;
  /** ISO yyyy-mm-dd, or null when still in force. */
  effective_to: string | null;
  payload: TPayload & { _unverified?: boolean; _source_go?: RateSource };
}

export interface ResolvedRate<TPayload> {
  payload: TPayload;
  effectiveFrom: string;
  effectiveTo: string | null;
  source: RateSource | null;
  /**
   * True when the rate has not been checked against its GO. Calculators must
   * surface this — an unverified figure presenting itself as authoritative is
   * the failure mode PLAN.md Part 5 checkpoint 3 exists to prevent.
   */
  unverified: boolean;
}

export class RateNotFoundError extends Error {
  constructor(kind: RateKind, on: string) {
    super(
      `No ${kind} rate is on record for ${on}. Rates come from the rates table ` +
        `(CLAUDE.md rule 1); seed or verify the row before calculating.`,
    );
    this.name = "RateNotFoundError";
  }
}

function isWithin(row: RateRow, iso: string): boolean {
  if (row.effective_from > iso) return false;
  return row.effective_to === null || row.effective_to >= iso;
}

/**
 * The rate in force on a date.
 *
 * Comparison is on ISO date strings, which sort lexicographically — no Date
 * objects, so no timezone can shift an arrears month across a boundary.
 */
export function rateOn<TPayload>(
  rows: RateRow<TPayload>[],
  kind: RateKind,
  isoDate: string,
): ResolvedRate<TPayload> {
  const candidates = rows.filter((row) => row.kind === kind && isWithin(row, isoDate));

  if (candidates.length === 0) throw new RateNotFoundError(kind, isoDate);

  // Latest effective_from wins when periods overlap, which happens when a GO is
  // superseded mid-period and both rows are still on record.
  const chosen = candidates.reduce((best, row) =>
    row.effective_from > best.effective_from ? row : best,
  );

  const { _unverified, _source_go, ...payload } = chosen.payload;

  return {
    payload: payload as TPayload,
    effectiveFrom: chosen.effective_from,
    effectiveTo: chosen.effective_to,
    source: _source_go ?? null,
    unverified: _unverified === true,
  };
}

/** Every rate of a kind, oldest first — for a month-by-month arrears walk. */
export function ratesOfKind<TPayload>(
  rows: RateRow<TPayload>[],
  kind: RateKind,
): RateRow<TPayload>[] {
  return rows
    .filter((row) => row.kind === kind)
    .sort((a, b) => a.effective_from.localeCompare(b.effective_from));
}

/** A citation line: "as per G.O.Ms.No.60 dt 20.10.2025". */
export function rateCitation(source: RateSource | null): string | null {
  if (source === null || source.go_number === null) return null;
  const date = source.go_date === null ? null : formatGoDate(source.go_date);
  return date === null ? `as per ${source.go_number}` : `as per ${source.go_number} dt ${date}`;
}

export function formatGoDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (match === null) return isoDate;
  const [, year, month, day] = match;
  return `${day}.${month}.${year}`;
}

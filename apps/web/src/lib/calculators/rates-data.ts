import type { RateRow } from "@ap-emp-ai/calc";
import ratesConfig from "../../../../../config/rates/rps-2022.json";

/**
 * Rates for the client-side calculators.
 *
 * PLAN.md Part 1.2 requires the calculators to work "offline-ish", so the rates
 * are bundled from config/rates at build time rather than fetched. That file is
 * the same source the database seed is generated from, so a browser and the
 * server cannot disagree about a DA percentage.
 *
 * The trade-off is that a rate change needs a redeploy. That is the right way
 * round: a DA revision arrives a few times a year and goes through review
 * anyway, whereas a calculator that breaks when the network does is useless on
 * a phone in a government office.
 */

interface RawRate {
  effective_from: string;
  effective_to: string | null;
  payload: Record<string, unknown>;
  source_go: {
    go_number: string | null;
    go_date: string | null;
    verified: boolean;
    note?: string | null;
  };
}

type RatesConfig = Record<string, RawRate[] | Record<string, unknown>>;

/** Flattens the config's per-kind shape into the rows rateOn expects. */
function toRows(config: RatesConfig): RateRow[] {
  const rows: RateRow[] = [];

  for (const [kind, value] of Object.entries(config)) {
    // _meta and any other bookkeeping key.
    if (kind.startsWith("_") || !Array.isArray(value)) continue;

    for (const raw of value as RawRate[]) {
      rows.push({
        kind: kind as RateRow["kind"],
        effective_from: raw.effective_from,
        effective_to: raw.effective_to,
        payload: {
          ...raw.payload,
          // Mirrors what the SQL seed writes, so a calculator behaves the same
          // whether its rates came from the bundle or the database.
          _unverified: !raw.source_go.verified,
          _source_go: raw.source_go,
        },
      });
    }
  }

  return rows;
}

export const RATES: RateRow[] = toRows(ratesConfig as unknown as RatesConfig);

export function ratesFor<TPayload>(kind: RateRow["kind"]): RateRow<TPayload>[] {
  return RATES.filter((row) => row.kind === kind) as RateRow<TPayload>[];
}

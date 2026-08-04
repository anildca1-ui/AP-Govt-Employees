import { describe, expect, it } from "vitest";
import {
  rateCitation,
  rateOn,
  RateNotFoundError,
  ratesOfKind,
  type RateRow,
} from "./rates.js";

interface DaPayload {
  percent: number;
}

const DA: RateRow<DaPayload>[] = [
  {
    kind: "DA",
    effective_from: "2023-07-01",
    effective_to: "2023-12-31",
    payload: { percent: 33.67, _unverified: true, _source_go: { go_number: "G.O.Ms.No.30", go_date: null, verified: false } },
  },
  {
    kind: "DA",
    effective_from: "2024-01-01",
    effective_to: null,
    payload: {
      percent: 37.31,
      _unverified: true,
      _source_go: { go_number: "G.O.Ms.No.60", go_date: "2025-10-20", verified: false },
    },
  },
  {
    kind: "DA",
    effective_from: "2022-01-01",
    effective_to: "2022-06-30",
    payload: { percent: 22.75 },
  },
];

describe("rateOn", () => {
  it("returns the rate in force on the date", () => {
    expect(rateOn(DA, "DA", "2025-03-15").payload.percent).toBe(37.31);
    expect(rateOn(DA, "DA", "2023-09-01").payload.percent).toBe(33.67);
    expect(rateOn(DA, "DA", "2022-03-01").payload.percent).toBe(22.75);
  });

  it("includes both endpoints of a period", () => {
    expect(rateOn(DA, "DA", "2023-07-01").payload.percent).toBe(33.67);
    expect(rateOn(DA, "DA", "2023-12-31").payload.percent).toBe(33.67);
  });

  it("treats a null effective_to as still in force", () => {
    expect(rateOn(DA, "DA", "2099-01-01").payload.percent).toBe(37.31);
  });

  it("throws rather than guessing when no rate covers the date", () => {
    // Silently falling back to the nearest rate would produce a plausible,
    // wrong arrears figure — worse than refusing.
    expect(() => rateOn(DA, "DA", "2019-01-01")).toThrow(RateNotFoundError);
    expect(() => rateOn(DA, "DA", "2022-08-01")).toThrow(RateNotFoundError);
  });

  it("names the rule in the error, so the fix is obvious", () => {
    expect(() => rateOn(DA, "DA", "2019-01-01")).toThrow(/rates table/);
  });

  it("prefers the later row when two periods overlap", () => {
    const overlapping: RateRow<DaPayload>[] = [
      { kind: "DA", effective_from: "2024-01-01", effective_to: null, payload: { percent: 37.31 } },
      { kind: "DA", effective_from: "2024-07-01", effective_to: null, payload: { percent: 40.0 } },
    ];

    expect(rateOn(overlapping, "DA", "2025-01-01").payload.percent).toBe(40.0);
  });

  it("does not mix rate kinds", () => {
    const mixed: RateRow<DaPayload>[] = [
      ...DA,
      { kind: "HRA", effective_from: "2024-01-01", effective_to: null, payload: { percent: 24 } },
    ];

    expect(rateOn(mixed, "DA", "2025-01-01").payload.percent).toBe(37.31);
    expect(rateOn(mixed, "HRA", "2025-01-01").payload.percent).toBe(24);
  });

  it("surfaces the unverified flag so calculators can warn", () => {
    const resolved = rateOn(DA, "DA", "2025-03-15");

    expect(resolved.unverified).toBe(true);
    expect(resolved.source?.go_number).toBe("G.O.Ms.No.60");
  });

  it("strips the bookkeeping keys out of the payload", () => {
    // A calculator reading payload should see rate data, not our metadata.
    const resolved = rateOn(DA, "DA", "2025-03-15");

    expect(resolved.payload).toEqual({ percent: 37.31 });
    expect("_unverified" in resolved.payload).toBe(false);
  });

  it("reports a row with no provenance as unverified-source rather than crashing", () => {
    const resolved = rateOn(DA, "DA", "2022-03-01");

    expect(resolved.source).toBeNull();
    expect(resolved.unverified).toBe(false);
  });

  it("compares dates as strings, so no timezone can shift a period boundary", () => {
    // An arrears walk steps month by month; a Date-based comparison in IST vs
    // UTC would move a month across a DA change and misprice it.
    expect(rateOn(DA, "DA", "2023-12-31").payload.percent).toBe(33.67);
    expect(rateOn(DA, "DA", "2024-01-01").payload.percent).toBe(37.31);
  });
});

describe("ratesOfKind", () => {
  it("returns one kind, oldest first, for a month-by-month walk", () => {
    expect(ratesOfKind(DA, "DA").map((r) => r.effective_from)).toEqual([
      "2022-01-01",
      "2023-07-01",
      "2024-01-01",
    ]);
  });

  it("returns [] for a kind with no rows", () => {
    expect(ratesOfKind(DA, "APGLI")).toEqual([]);
  });
});

describe("rateCitation", () => {
  it('renders "as per G.O.Ms.No.60 dt 20.10.2025"', () => {
    expect(rateCitation({ go_number: "G.O.Ms.No.60", go_date: "2025-10-20", verified: true })).toBe(
      "as per G.O.Ms.No.60 dt 20.10.2025",
    );
  });

  it("omits an unknown date rather than printing a placeholder", () => {
    expect(rateCitation({ go_number: "G.O.Ms.No.30", go_date: null, verified: false })).toBe(
      "as per G.O.Ms.No.30",
    );
  });

  it("returns null when there is nothing to cite", () => {
    expect(rateCitation(null)).toBeNull();
    expect(rateCitation({ go_number: null, go_date: null, verified: false })).toBeNull();
  });
});

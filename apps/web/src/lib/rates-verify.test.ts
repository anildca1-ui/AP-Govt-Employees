import { describe, expect, it } from "vitest";
import * as verify from "../../../../scripts/lib/rates-verify.mjs";

type Row = {
  effective_from: string;
  effective_to: string | null;
  payload: Record<string, unknown>;
  source_go: Record<string, unknown>;
};
type Rates = Record<string, Row[]>;

/** The fixture always has these rows; this keeps the assertions readable. */
const da = (rates: Rates, index: number): Row => (rates.DA as Row[])[index] as Row;

const {
  unverifiedRows,
  describe: describeRow,
  pdfFor,
  markVerified,
  markCorrected,
} = verify as unknown as {
  unverifiedRows: (rates: Rates) => { kind: string; index: number; row: Row }[];
  describe: (kind: string, row: Row) => string;
  pdfFor: (go: string | null, sources: unknown) => string | null;
  markVerified: (rates: Rates, kind: string, index: number, opts: Record<string, unknown>) => Rates;
  markCorrected: (rates: Rates, kind: string, index: number, opts: Record<string, unknown>) => Rates;
};

/**
 * Marking a rate verified removes the warning from the page, so from that
 * moment the figure presents itself to a government employee as checked
 * against the Government Order. These tests guard the two ways that could go
 * wrong quietly: a rate becoming verified when nobody said so, and a corrected
 * figure inheriting a confirmation it never earned.
 */
const rates = (): Rates => ({
  DA: [
    {
      effective_from: "2024-01-01",
      effective_to: null,
      payload: { percent: 37.31, applies_to: "basic_pay" },
      source_go: { go_number: "G.O.Ms.No.60", go_date: null, verified: false, note: "from research" },
    },
    {
      effective_from: "2023-07-01",
      effective_to: "2023-12-31",
      payload: { percent: 33.67 },
      source_go: { go_number: null, verified: true },
    },
  ],
  _readme: [] as unknown as Row[],
});

describe("unverifiedRows", () => {
  it("lists only what nobody has confirmed", () => {
    const pending = unverifiedRows(rates());

    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ kind: "DA", index: 0 });
  });

  it("treats anything that is not exactly true as unverified", () => {
    // A truthy-but-not-true value must not pass for a confirmation.
    const loose = rates();
    da(loose, 0).source_go.verified = "yes" as unknown as boolean;

    expect(unverifiedRows(loose)).toHaveLength(1);
  });
});

describe("describe", () => {
  it("shows the period and the figure being claimed", () => {
    expect(describeRow("DA", da(rates(), 0))).toContain("2024-01-01");
    expect(describeRow("DA", da(rates(), 0))).toContain("37.31%");
  });

  it("says 'open' for a rate with no end date", () => {
    expect(describeRow("DA", da(rates(), 0))).toContain("open");
  });
});

describe("pdfFor", () => {
  const sources = {
    documents: [
      { url: "https://example.org/60.pdf", claim: "G.O.Ms.No.60, Finance, 20-10-2025 — DA" },
      { url: "https://example.org/101.pdf", claim: "GO Ms No.101 Dt.11.05.2022 — PRC" },
    ],
  };

  it("finds the order however its number is written", () => {
    expect(pdfFor("G.O.Ms.No.60", sources)).toBe("https://example.org/60.pdf");
    expect(pdfFor("G.O.Ms.No.101", sources)).toBe("https://example.org/101.pdf");
  });

  it("does not offer a PDF for an order it does not have", () => {
    expect(pdfFor("G.O.Ms.No.999", sources)).toBeNull();
    expect(pdfFor(null, sources)).toBeNull();
  });

  it("never confuses one order number for another", () => {
    // 60 must not match 601, and 101 must not match 10.
    const near = { documents: [{ url: "https://example.org/601.pdf", claim: "G.O.Ms.No.601" }] };
    expect(pdfFor("G.O.Ms.No.60", near)).toBeNull();
  });
});

describe("markVerified", () => {
  it("records who checked it and when, and clears the research note", () => {
    const after = markVerified(rates(), "DA", 0, { checkedOn: "2026-08-09" });

    expect(da(after, 0).source_go).toMatchObject({ verified: true, verified_on: "2026-08-09" });
    // The old note said "from research", which is exactly what is no longer so.
    expect(da(after, 0).source_go.note).toBeNull();
  });

  it("leaves every other rate alone", () => {
    const after = markVerified(rates(), "DA", 0, { checkedOn: "2026-08-09" });

    expect(da(after, 1)).toEqual(da(rates(), 1));
  });

  it("does not mutate the input", () => {
    const before = rates();
    markVerified(before, "DA", 0, { checkedOn: "2026-08-09" });

    expect(da(before, 0).source_go.verified).toBe(false);
  });

  it("keeps the figure exactly as it was", () => {
    // Confirming is a statement about the figure, never a change to it.
    const after = markVerified(rates(), "DA", 0, { checkedOn: "2026-08-09" });

    expect(da(after, 0).payload).toEqual({ percent: 37.31, applies_to: "basic_pay" });
  });
});

describe("markCorrected", () => {
  it("changes the figure but does NOT mark it verified", () => {
    // A figure typed from someone's reading is still a transcription. It keeps
    // its warning until it is confirmed in its own turn.
    const after = markCorrected(rates(), "DA", 0, {
      checkedOn: "2026-08-09",
      correction: { percent: 36.0 },
    });

    expect(da(after, 0).payload.percent).toBe(36.0);
    expect(da(after, 0).source_go.verified).toBe(false);
    expect(da(after, 0).source_go.corrected_on).toBe("2026-08-09");
  });

  it("keeps the rest of the payload", () => {
    const after = markCorrected(rates(), "DA", 0, {
      checkedOn: "2026-08-09",
      correction: { percent: 36.0 },
    });

    expect(da(after, 0).payload.applies_to).toBe("basic_pay");
  });

  it("leaves a note saying the new figure still needs confirming", () => {
    const after = markCorrected(rates(), "DA", 0, {
      checkedOn: "2026-08-09",
      correction: { percent: 36.0 },
    });

    expect(String(da(after, 0).source_go.note)).toMatch(/confirm/i);
  });
});

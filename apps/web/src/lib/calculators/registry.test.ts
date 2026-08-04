import { describe, expect, it } from "vitest";
import { getDictionary } from "@/i18n/dictionary";
import { locales } from "@/i18n/config";
import { CALCULATORS, labelsFor, searchCalculators } from "./registry";
import { RATES, ratesFor } from "./rates-data";

const dict = getDictionary("te");

describe("calculator registry", () => {
  it("lists all 13 calculators from PLAN.md Part 4", () => {
    expect(CALCULATORS).toHaveLength(13);
  });

  it("uses unique ids and slugs", () => {
    expect(new Set(CALCULATORS.map((c) => c.id)).size).toBe(13);
    expect(new Set(CALCULATORS.map((c) => c.slug)).size).toBe(13);
  });

  it("has a title and description in every locale", () => {
    // A missing entry would render the slug — visible, but wrong.
    for (const locale of locales) {
      const localeDict = getDictionary(locale);
      for (const meta of CALCULATORS) {
        const { title, description } = labelsFor(meta, localeDict);
        expect(title, `${meta.slug} title in ${locale}`).not.toBe(meta.slug);
        expect(description.length, `${meta.slug} description in ${locale}`).toBeGreaterThan(0);
      }
    }
  });

  it("features the launch-wedge calculators", () => {
    // PLAN.md Part 6: DA arrears is one of the three things worth launching on.
    expect(CALCULATORS.filter((c) => c.featured).map((c) => c.slug)).toContain("da-arrears");
  });
});

describe("searchCalculators", () => {
  it("returns everything for an empty query", () => {
    expect(searchCalculators("", dict)).toHaveLength(13);
  });

  it("matches the Telugu title, so a Telugu speaker need not know the English name", () => {
    const hits = searchCalculators("గ్రాట్యుటీ", dict);

    expect(hits.map((c) => c.slug)).toContain("gratuity");
  });

  it("matches the slug for someone typing English", () => {
    expect(searchCalculators("gratuity", dict).map((c) => c.slug)).toEqual(["gratuity"]);
  });

  it("ignores surrounding whitespace and case", () => {
    expect(searchCalculators("  DA-ARREARS  ", dict).map((c) => c.slug)).toContain("da-arrears");
  });

  it("returns nothing for a query that matches nothing", () => {
    expect(searchCalculators("zzzznotacalculator", dict)).toEqual([]);
  });
});

describe("bundled rates", () => {
  it("ships the rates the client-side calculators need", () => {
    // PLAN.md Part 1.2 wants the calculators usable without a network.
    expect(ratesFor("DA").length).toBeGreaterThan(0);
    expect(ratesFor("MASTER_SCALE")).toHaveLength(1);
    expect(ratesFor("NPS")).toHaveLength(1);
  });

  it("marks every bundled rate unverified, matching the SQL seed", () => {
    // If these disagreed, a calculator would warn or not depending on whether
    // its rates came from the bundle or the database.
    for (const row of RATES) {
      expect(row.payload._unverified, `${row.kind} ${row.effective_from}`).toBe(true);
    }
  });

  it("carries the source GO through to the bundle", () => {
    const da = ratesFor<{ percent: number }>("DA");
    const latest = da.reduce((a, b) => (a.effective_from > b.effective_from ? a : b));

    expect(latest.payload._source_go?.go_number).toBe("G.O.Ms.No.60");
  });

  it("expands the master scale to its full 83 stages", () => {
    const scale = ratesFor<{ stages: number[]; minimum: number; maximum: number }>("MASTER_SCALE")[0];

    expect(scale?.payload.stages).toHaveLength(83);
    expect(scale?.payload.stages[0]).toBe(20000);
    expect(scale?.payload.stages.at(-1)).toBe(179000);
  });
});

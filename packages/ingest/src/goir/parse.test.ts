import { describe, expect, it } from "vitest";
import { parseGoNumber, parseIndexRows, parseIssueDate, withinLastDays } from "./parse.js";
import type { RawIndexRow } from "./types.js";

const BASE = "https://goir.ap.gov.in/";
const TODAY = new Date("2025-04-30T09:00:00Z");

function row(overrides: Partial<RawIndexRow> = {}): RawIndexRow {
  return {
    goNumber: "G.O.Ms.No.51",
    department: "Finance",
    issueDate: "15/04/2025",
    subject: "Dearness Allowance to State Government Employees",
    href: "/Documents/51.pdf",
    ...overrides,
  };
}

describe("parseIssueDate", () => {
  it("reads Indian little-endian dates", () => {
    // 01/04/2025 is 1 April. Reading it as 4 January would shift every arrear
    // month downstream.
    expect(parseIssueDate("01/04/2025")).toBe("2025-04-01");
    expect(parseIssueDate("15/04/2025")).toBe("2025-04-15");
  });

  it("accepts the separators that appear in the corpus", () => {
    expect(parseIssueDate("01-04-2025")).toBe("2025-04-01");
    expect(parseIssueDate("01.04.2025")).toBe("2025-04-01");
    expect(parseIssueDate("1/4/2025")).toBe("2025-04-01");
    expect(parseIssueDate("  15/04/2025  ")).toBe("2025-04-15");
  });

  it("rejects a day that does not exist rather than rolling it forward", () => {
    // new Date(2025, 1, 31) silently becomes 3 March.
    expect(parseIssueDate("31/02/2025")).toBeNull();
    expect(parseIssueDate("31/04/2025")).toBeNull();
    expect(parseIssueDate("29/02/2025")).toBeNull();
  });

  it("keeps a genuine leap day", () => {
    expect(parseIssueDate("29/02/2024")).toBe("2024-02-29");
  });

  it("rejects out-of-range and malformed values", () => {
    for (const bad of ["", "not a date", "13/13/2025", "00/04/2025", "2025-04-01", "15/04/25"]) {
      expect(parseIssueDate(bad), bad).toBeNull();
    }
  });
});

describe("parseGoNumber", () => {
  it("canonicalises Ms and Rt orders", () => {
    expect(parseGoNumber("G.O.Ms.No.51")).toEqual({ goNumber: "G.O.Ms.No.51", goType: "Ms" });
    expect(parseGoNumber("G.O.Rt.No.1234")).toEqual({ goNumber: "G.O.Rt.No.1234", goType: "Rt" });
  });

  it("normalises the spacing and casing the site actually uses", () => {
    for (const variant of ["GO Ms No 51", "G.O.MS.No. 51", "g.o.ms.no.51", "G.O.Ms.No.051"]) {
      expect(parseGoNumber(variant), variant).toEqual({
        goNumber: "G.O.Ms.No.51",
        goType: "Ms",
      });
    }
  });

  it("recognises memos and circulars", () => {
    expect(parseGoNumber("Memo No. 12345")).toEqual({ goNumber: "Memo.No.12345", goType: "Memo" });
    expect(parseGoNumber("Circular No.77")).toEqual({
      goNumber: "Circular.No.77",
      goType: "Circular",
    });
  });

  it("keeps an unrecognised number instead of dropping the document", () => {
    // It still reaches the review queue, where a human can fix the metadata —
    // better than silently losing a GO because the format was unexpected.
    expect(parseGoNumber("Proc.Rc.No.55/2025")).toEqual({
      goNumber: "Proc.Rc.No.55/2025",
      goType: null,
    });
  });

  it("returns null only when there is nothing at all", () => {
    expect(parseGoNumber("   ")).toBeNull();
  });
});

describe("withinLastDays", () => {
  const today = new Date("2025-04-30T23:59:00Z");

  it("includes today and the far edge of the window", () => {
    expect(withinLastDays("2025-04-30", 30, today)).toBe(true);
    expect(withinLastDays("2025-04-01", 30, today)).toBe(true);
  });

  it("excludes the day just before the window", () => {
    expect(withinLastDays("2025-03-31", 30, today)).toBe(false);
  });

  it("excludes future-dated rows, which are site data errors", () => {
    expect(withinLastDays("2025-05-01", 30, today)).toBe(false);
  });

  it("is not fooled by the time of day", () => {
    const earlyMorning = new Date("2025-04-30T00:01:00Z");
    expect(withinLastDays("2025-04-30", 30, earlyMorning)).toBe(true);
    expect(withinLastDays("2025-04-01", 30, earlyMorning)).toBe(true);
  });
});

describe("parseIndexRows", () => {
  const options = { baseUrl: BASE, days: 30, today: TODAY };

  it("turns a good row into a queueable entry", () => {
    const { entries, skipped } = parseIndexRows([row()], options);

    expect(skipped).toEqual([]);
    expect(entries).toEqual([
      {
        goNumber: "G.O.Ms.No.51",
        goType: "Ms",
        department: "Finance",
        issueDate: "2025-04-15",
        subject: "Dearness Allowance to State Government Employees",
        pdfUrl: "https://goir.ap.gov.in/Documents/51.pdf",
      },
    ]);
  });

  it("absolutises relative links against the index URL", () => {
    const { entries } = parseIndexRows(
      [row({ href: "Documents/51.pdf" }), row({ href: "https://cdn.ap.gov.in/x.pdf" })],
      options,
    );

    expect(entries.map((e) => e.pdfUrl)).toEqual([
      "https://goir.ap.gov.in/Documents/51.pdf",
      "https://cdn.ap.gov.in/x.pdf",
    ]);
  });

  it("drops rows outside the window and says why", () => {
    const { entries, skipped } = parseIndexRows([row({ issueDate: "01/01/2025" })], options);

    expect(entries).toEqual([]);
    expect(skipped[0]?.reason).toMatch(/outside the 30-day window/);
  });

  it("keeps going when one row is malformed", () => {
    // One broken row on the index page must not cost us the whole night's crawl.
    const { entries, skipped } = parseIndexRows(
      [row(), row({ issueDate: "garbage" }), row({ goNumber: "G.O.Ms.No.52" })],
      options,
    );

    expect(entries).toHaveLength(2);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.reason).toMatch(/unparseable date/);
  });

  it("collapses the whitespace that table cells carry", () => {
    const { entries } = parseIndexRows(
      [row({ department: "  Finance   (FIN)\n ", subject: "Dearness\n\tAllowance " })],
      options,
    );

    expect(entries[0]?.department).toBe("Finance (FIN)");
    expect(entries[0]?.subject).toBe("Dearness Allowance");
  });
});

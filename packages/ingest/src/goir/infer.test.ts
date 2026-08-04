import { describe, expect, it } from "vitest";
import {
  inferColumns,
  looksLikeGoNumber,
  ROW_QUALITY_FLOOR,
  rowsFromInference,
  scoreRows,
  type TableSnapshot,
} from "./infer.js";

/**
 * The point of inference is to survive markup nobody has seen, so these are
 * built as plausible variants of the same listing rather than as one fixture:
 * different column orders, extra columns, missing headers, Telugu headers. If
 * inference only works on the shape I imagined, it has bought nothing over the
 * positional selectors it exists to back up.
 */

const cell = (text: string, href: string | null = null) => ({ text, href });

/** The shape selectors.ts assumes: number, department, date, subject. */
const canonical: TableSnapshot = {
  headers: ["G.O. Number", "Department", "Date", "Subject"],
  rows: [
    {
      cells: [
        cell("G.O.Ms.No.60"),
        cell("Finance"),
        cell("12/03/2025"),
        cell("Dearness Allowance to State Government Employees - Enhanced - Orders issued"),
        cell("Download", "/go/2025/fin_ms60.pdf"),
      ],
    },
    {
      cells: [
        cell("G.O.Rt.No.412"),
        cell("Finance"),
        cell("18/03/2025"),
        cell("Pay revision arrears - sanction of second instalment - Orders issued"),
        cell("Download", "/go/2025/fin_rt412.pdf"),
      ],
    },
    {
      cells: [
        cell("G.O.Ms.No.61"),
        cell("School Education"),
        cell("21/03/2025"),
        cell("Transfers and postings of Head Masters - guidelines - issued"),
        cell("Download", "/go/2025/se_ms61.pdf"),
      ],
    },
  ],
};

describe("looksLikeGoNumber", () => {
  it("accepts the forms a listing actually prints", () => {
    for (const value of [
      "G.O.Ms.No.60",
      "G.O.MS.No. 60",
      "G O Ms No 60",
      "G.O.Rt.No.412",
      "Memo No. 1234567",
      "Circular Memo No.55",
    ]) {
      expect(looksLikeGoNumber(value), value).toBe(true);
    }
  });

  it("rejects a date, a department and a sentence mentioning a GO", () => {
    for (const value of [
      "12/03/2025",
      "Finance",
      "",
      "In continuation of the orders issued in the G.O. read above, government have reviewed the matter and decided to enhance the rate with effect from the first of the month",
    ]) {
      expect(looksLikeGoNumber(value), value).toBe(false);
    }
  });
});

describe("inferColumns", () => {
  it("maps the canonical layout", () => {
    const inferred = inferColumns(canonical);

    expect(inferred.columns.goNumber).toBe(0);
    expect(inferred.columns.department).toBe(1);
    expect(inferred.columns.issueDate).toBe(2);
    expect(inferred.columns.subject).toBe(3);
    expect(inferred.linkCell).toBe(4);
    expect(inferred.confidence).toBeGreaterThan(0.9);
  });

  it("follows the content when the columns are reordered", () => {
    // The failure mode positional selectors have and this does not.
    const reordered: TableSnapshot = {
      headers: ["Date", "Subject", "G.O. Number", "Department"],
      rows: canonical.rows.map((row) => ({
        cells: [row.cells[2]!, row.cells[3]!, row.cells[0]!, row.cells[1]!, row.cells[4]!],
      })),
    };

    const inferred = inferColumns(reordered);

    expect(inferred.columns.issueDate).toBe(0);
    expect(inferred.columns.subject).toBe(1);
    expect(inferred.columns.goNumber).toBe(2);
    expect(inferred.columns.department).toBe(3);
  });

  it("works with no header row at all", () => {
    const headerless: TableSnapshot = { headers: [], rows: canonical.rows };

    const inferred = inferColumns(headerless);

    expect(inferred.columns.goNumber).toBe(0);
    expect(inferred.columns.issueDate).toBe(2);
    expect(inferred.columns.subject).toBe(3);
    expect(inferred.linkCell).toBe(4);
  });

  it("ignores a leading serial-number column", () => {
    // Very common in these listings, and it shifts every positional selector.
    const withSerial: TableSnapshot = {
      headers: ["Sl. No.", "G.O. Number", "Department", "Date", "Subject"],
      rows: canonical.rows.map((row, index) => ({
        cells: [cell(String(index + 1)), ...row.cells],
      })),
    };

    const inferred = inferColumns(withSerial);

    expect(inferred.columns.goNumber).toBe(1);
    expect(inferred.columns.department).toBe(2);
    expect(inferred.columns.issueDate).toBe(3);
    expect(inferred.columns.subject).toBe(4);
    expect(inferred.linkCell).toBe(5);
  });

  it("reads a Telugu header row from the content instead", () => {
    const telugu: TableSnapshot = {
      headers: ["జీవో నంబర్", "శాఖ", "తేదీ", "విషయం", ""],
      rows: canonical.rows,
    };

    const inferred = inferColumns(telugu);

    expect(inferred.columns.goNumber).toBe(0);
    expect(inferred.columns.issueDate).toBe(2);
    expect(inferred.columns.subject).toBe(3);
  });

  it("does not mistake a navigation anchor for the document link", () => {
    const noDocs: TableSnapshot = {
      headers: canonical.headers,
      rows: canonical.rows.map((row) => ({
        cells: [...row.cells.slice(0, 4), cell("Details", "javascript:void(0)")],
      })),
    };

    expect(inferColumns(noDocs).linkCell).toBeNull();
  });

  it("reports low confidence rather than inventing a mapping", () => {
    const junk: TableSnapshot = {
      headers: ["a", "b"],
      rows: [{ cells: [cell("x"), cell("y")] }],
    };

    const inferred = inferColumns(junk);

    expect(inferred.confidence).toBeLessThan(0.5);
    expect(inferred.columns.goNumber).toBeNull();
    expect(inferred.notes.join(" ")).toMatch(/goNumber: not found/);
  });

  it("returns something usable for an empty table", () => {
    const inferred = inferColumns({ headers: [], rows: [] });

    expect(inferred.confidence).toBe(0);
    expect(inferred.linkCell).toBeNull();
  });
});

describe("scoreRows", () => {
  const good = [
    { goNumber: "G.O.Ms.No.60", issueDate: "12/03/2025", href: "/a.pdf" },
    { goNumber: "G.O.Rt.No.412", issueDate: "18/03/2025", href: "/b.pdf" },
  ];

  it("scores a correct extraction near 1", () => {
    expect(scoreRows(good)).toBeGreaterThan(0.95);
  });

  it("scores the serial-column slip below the floor", () => {
    // The real failure this guards: td:nth-child(1) matched, but it matched the
    // row number. Dates and links are fine, so a row-count check sees success
    // and every GO gets filed under "1", "2", "3".
    const shifted = good.map((row, index) => ({ ...row, goNumber: String(index + 1) }));

    expect(scoreRows(shifted)).toBeLessThan(ROW_QUALITY_FLOOR);
  });

  it("scores an empty extraction at 0", () => {
    expect(scoreRows([])).toBe(0);
  });

  it("penalises rows that lost their link", () => {
    const linkless = good.map((row) => ({ ...row, href: "" }));

    expect(scoreRows(linkless)).toBeLessThan(scoreRows(good));
  });

  it("tolerates a few odd rows in an otherwise good listing", () => {
    // Real listings carry the occasional corrigendum with an unusual number.
    const mostlyGood = [...good, ...good, ...good, ...good, { goNumber: "—", issueDate: "—", href: "" }];

    expect(scoreRows(mostlyGood)).toBeGreaterThan(ROW_QUALITY_FLOOR);
  });
});

describe("rowsFromInference", () => {
  it("produces rows parseIndexRows can consume", () => {
    const rows = rowsFromInference(canonical, inferColumns(canonical));

    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      goNumber: "G.O.Ms.No.60",
      department: "Finance",
      issueDate: "12/03/2025",
      subject: "Dearness Allowance to State Government Employees - Enhanced - Orders issued",
      href: "/go/2025/fin_ms60.pdf",
    });
  });

  it("drops rows with no document link rather than queueing a dead entry", () => {
    const withHeaderRow: TableSnapshot = {
      headers: canonical.headers,
      rows: [{ cells: [cell("G.O. Number"), cell("Department"), cell("Date"), cell("Subject")] }, ...canonical.rows],
    };

    expect(rowsFromInference(withHeaderRow, inferColumns(withHeaderRow))).toHaveLength(3);
  });

  it("still finds the link when no single column holds it consistently", () => {
    // Some listings put the anchor on the GO number itself.
    const linkOnNumber: TableSnapshot = {
      headers: ["G.O. Number", "Department", "Date", "Subject"],
      rows: canonical.rows.map((row) => ({
        cells: [
          cell(row.cells[0]!.text, row.cells[4]!.href),
          row.cells[1]!,
          row.cells[2]!,
          row.cells[3]!,
        ],
      })),
    };

    const rows = rowsFromInference(linkOnNumber, inferColumns(linkOnNumber));

    expect(rows).toHaveLength(3);
    expect(rows[0]?.href).toBe("/go/2025/fin_ms60.pdf");
    expect(rows[0]?.goNumber).toBe("G.O.Ms.No.60");
  });
});

import { parseIssueDate } from "./parse.js";

/**
 * Works out which column of a GO listing holds what, from the content itself.
 *
 * selectors.ts pins columns by position — `td:nth-child(2)` is the department —
 * which is a guess written without ever loading the page, and a guess that is
 * wrong in a way that produces zero rows rather than an error. Every extra
 * column, reordering, or redesign breaks it silently.
 *
 * This does not guess. A GO number looks like a GO number, a date parses as a
 * date, a subject is the long free-text one, and the PDF link is an anchor. Those
 * hold across markup a positional selector cannot survive, so the scraper can
 * work on first contact with a page nobody has inspected — and keep working when
 * the site is redesigned.
 *
 * Positional selectors stay the fast path: when they match, they are used. This
 * runs when they find nothing, and its findings are what the verifier prints so
 * a correction is one edit rather than a round of guesswork.
 */

export interface InferCell {
  text: string;
  /** href of an anchor inside this cell, if any. */
  href: string | null;
}

export interface InferRow {
  cells: InferCell[];
}

export interface TableSnapshot {
  /** Header cell texts, empty if the table has no header row. */
  headers: string[];
  rows: InferRow[];
}

export type ColumnRole = "goNumber" | "issueDate" | "department" | "subject";

export const COLUMN_ROLES: ColumnRole[] = ["goNumber", "issueDate", "department", "subject"];

export interface InferredColumns {
  columns: Record<ColumnRole, number | null>;
  /** Cell index holding the document link; null when no cell has a usable one. */
  linkCell: number | null;
  /** 0–1. Below ~0.5 the mapping is a guess and should be shown, not trusted. */
  confidence: number;
  /** Why each column was chosen — printed by verify:selectors. */
  notes: string[];
}

/** Header words that name a role outright. Strongest signal available. */
const HEADER_HINTS: Record<ColumnRole, RegExp> = {
  goNumber: /\b(g\.?\s*o\.?|order|memo|circular)\b.*\b(no|number)\b|^\s*(g\.?\s*o\.?|order)\s*(no|number)/i,
  issueDate: /\b(date|dated|issued\s*on|issue\s*date)\b/i,
  department: /\b(department|dept|administrative)\b/i,
  subject: /\b(subject|abstract|title|description|particulars)\b/i,
};

const GO_SHAPE = /\bG\.?\s*O\.?\s*(Ms|Rt|P)\.?\s*No\.?\s*\d/i;
const MEMO_SHAPE = /\b(Memo|Circular|Lr\.?\s*No)\b[^\d]{0,20}\d/i;

/** True when the text reads as a GO reference rather than as prose about one. */
export function looksLikeGoNumber(text: string): boolean {
  const value = text.trim().replace(/\s+/g, " ");
  if (value === "" || value.length > 80) return false;
  return GO_SHAPE.test(value) || MEMO_SHAPE.test(value);
}

function looksLikeDate(text: string): boolean {
  return parseIssueDate(text) !== null;
}

/** Fraction of rows whose cell in this column satisfies `test`. */
function rate(rows: InferRow[], column: number, test: (text: string) => boolean): number {
  if (rows.length === 0) return 0;
  let hits = 0;
  for (const row of rows) {
    const text = row.cells[column]?.text ?? "";
    if (test(text)) hits += 1;
  }
  return hits / rows.length;
}

function meanLength(rows: InferRow[], column: number): number {
  if (rows.length === 0) return 0;
  let total = 0;
  for (const row of rows) total += (row.cells[column]?.text ?? "").trim().length;
  return total / rows.length;
}

/** Distinct values over row count. A department repeats; a subject does not. */
function cardinality(rows: InferRow[], column: number): number {
  if (rows.length === 0) return 1;
  const seen = new Set<string>();
  for (const row of rows) seen.add((row.cells[column]?.text ?? "").trim().toLowerCase());
  return seen.size / rows.length;
}

function columnCount(table: TableSnapshot): number {
  return table.rows.reduce((max, row) => Math.max(max, row.cells.length), table.headers.length);
}

function scoreColumn(table: TableSnapshot, column: number, role: ColumnRole): number {
  const header = table.headers[column] ?? "";
  // A header that names the role outright outweighs any content heuristic: it is
  // the site telling us directly.
  const headerScore = HEADER_HINTS[role].test(header) ? 4 : 0;

  const rows = table.rows;
  const longest = Math.max(
    ...Array.from({ length: columnCount(table) }, (_, i) => meanLength(rows, i)),
    1,
  );

  let contentScore = 0;
  switch (role) {
    case "goNumber":
      contentScore = 3 * rate(rows, column, looksLikeGoNumber);
      break;
    case "issueDate":
      contentScore = 3 * rate(rows, column, looksLikeDate);
      break;
    case "department": {
      // Short, repeating, and neither a date nor a GO number.
      const clean = rate(
        rows,
        column,
        (t) => t.trim() !== "" && !looksLikeDate(t) && !looksLikeGoNumber(t) && t.trim().length <= 60,
      );
      const repeats = 1 - Math.min(cardinality(rows, column), 1);
      contentScore = 1.5 * clean + 1.5 * repeats;
      break;
    }
    case "subject": {
      // The long free-text column, and the one that never repeats.
      const relativeLength = meanLength(rows, column) / longest;
      const distinct = Math.min(cardinality(rows, column), 1);
      const clean = rate(rows, column, (t) => !looksLikeDate(t) && t.trim() !== "");
      contentScore = 2 * relativeLength + 0.8 * distinct + 0.2 * clean;
      break;
    }
  }

  return headerScore + contentScore;
}

/** Anchors that look like a document rather than navigation. */
function isDocumentHref(href: string | null): boolean {
  if (href === null || href.trim() === "") return false;
  const value = href.trim().toLowerCase();
  if (value.startsWith("javascript:") || value.startsWith("#")) return false;
  return (
    value.endsWith(".pdf") ||
    value.includes(".pdf?") ||
    /download|view|getfile|attachment|document|fileid/.test(value)
  );
}

function inferLinkCell(table: TableSnapshot): number | null {
  const width = columnCount(table);
  let best: { column: number; hits: number } | null = null;

  for (let column = 0; column < width; column++) {
    let hits = 0;
    for (const row of table.rows) {
      if (isDocumentHref(row.cells[column]?.href ?? null)) hits += 1;
    }
    if (hits > 0 && (best === null || hits > best.hits)) best = { column, hits };
  }

  // Require it on most rows: one stray "download the form" link in a footer row
  // is not the document column.
  if (best === null || best.hits / Math.max(table.rows.length, 1) < 0.5) return null;
  return best.column;
}

/**
 * Minimum score to accept an assignment. Below this the evidence is one weak
 * heuristic, and a wrong column is worse than an absent one — an absent column
 * shows up in the verifier, a wrong one silently mislabels every GO.
 */
const ACCEPT_THRESHOLD = 1.2;

export function inferColumns(table: TableSnapshot): InferredColumns {
  const width = columnCount(table);
  const columns: Record<ColumnRole, number | null> = {
    goNumber: null,
    issueDate: null,
    department: null,
    subject: null,
  };
  const notes: string[] = [];

  if (width === 0 || table.rows.length === 0) {
    return { columns, linkCell: null, confidence: 0, notes: ["no rows to infer from"] };
  }

  // Score every pairing, then take them best-first so a column claimed by a
  // strong signal is not stolen by a weaker one for another role.
  const candidates: { role: ColumnRole; column: number; score: number }[] = [];
  for (const role of COLUMN_ROLES) {
    for (let column = 0; column < width; column++) {
      candidates.push({ role, column, score: scoreColumn(table, column, role) });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  const takenColumns = new Set<number>();
  for (const { role, column, score } of candidates) {
    if (columns[role] !== null || takenColumns.has(column)) continue;
    if (score < ACCEPT_THRESHOLD) continue;
    columns[role] = column;
    takenColumns.add(column);
    const header = table.headers[column];
    notes.push(
      `${role}: column ${column}` +
        (header !== undefined && header !== "" ? ` ("${header}")` : "") +
        ` — score ${score.toFixed(2)}`,
    );
  }

  for (const role of COLUMN_ROLES) {
    if (columns[role] === null) notes.push(`${role}: not found`);
  }

  const linkCell = inferLinkCell(table);
  notes.push(linkCell === null ? "link: no document anchor found" : `link: column ${linkCell}`);

  // The GO number, the date and the link are what parseIndexRows requires; a
  // missing department or subject is a degraded row, not an unusable one.
  const essential = [columns.goNumber, columns.issueDate, linkCell].filter(
    (value) => value !== null,
  ).length;
  const optional = [columns.department, columns.subject].filter((v) => v !== null).length;
  const confidence = (essential / 3) * 0.8 + (optional / 2) * 0.2;

  return { columns, linkCell, confidence, notes };
}

export interface ScoredRow {
  goNumber: string;
  issueDate: string;
  href: string;
}

/**
 * How much the extracted rows look like a GO listing, 0–1.
 *
 * This exists because the dangerous failure is not "no rows" — it is rows that
 * are the wrong cells. `td:nth-child(1)` matches whatever is in the first
 * column; on a listing with a leading serial number that is "1", "2", "3", and
 * the GO number lands in the department field. Nothing downstream objects:
 * parseGoNumber deliberately keeps unrecognised text so a human can fix it in
 * review, so a full crawl completes, reports zero skipped, and files every
 * order under its row number.
 *
 * So extraction is judged on whether the cells hold what their names claim,
 * not on whether any rows came back.
 */
export function scoreRows(rows: ScoredRow[]): number {
  if (rows.length === 0) return 0;

  let goShaped = 0;
  let dated = 0;
  let linked = 0;
  for (const row of rows) {
    if (looksLikeGoNumber(row.goNumber)) goShaped += 1;
    if (parseIssueDate(row.issueDate) !== null) dated += 1;
    if (row.href.trim() !== "") linked += 1;
  }

  const n = rows.length;
  // The GO number is weighted hardest: it is the field that identifies the
  // document, and the one a positional slip corrupts most quietly.
  return (goShaped / n) * 0.5 + (dated / n) * 0.3 + (linked / n) * 0.2;
}

/**
 * Below this, the columns are not what they claim to be and inference should be
 * tried instead. A correct listing scores ~1.0; the serial-column slip scores
 * 0.5 (dates and links fine, not one GO number in the GO column).
 */
export const ROW_QUALITY_FLOOR = 0.7;

/** Applies an inferred mapping to a snapshot, producing scraper input rows. */
export function rowsFromInference(
  table: TableSnapshot,
  inferred: InferredColumns,
): { goNumber: string; department: string; issueDate: string; subject: string; href: string }[] {
  const at = (row: InferRow, column: number | null): string =>
    column === null ? "" : (row.cells[column]?.text ?? "").trim();

  return table.rows
    .map((row) => ({
      goNumber: at(row, inferred.columns.goNumber),
      department: at(row, inferred.columns.department),
      issueDate: at(row, inferred.columns.issueDate),
      subject: at(row, inferred.columns.subject),
      href:
        (inferred.linkCell === null
          ? // Fall back to any document anchor in the row rather than dropping it.
            (row.cells.find((cell) => isDocumentHref(cell.href))?.href ?? "")
          : (row.cells[inferred.linkCell]?.href ?? "")) ?? "",
    }))
    .filter((row) => row.href !== "");
}

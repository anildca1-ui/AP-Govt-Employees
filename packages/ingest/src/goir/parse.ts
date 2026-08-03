import type { GoIndexEntry, GoType, ParseResult, RawIndexRow } from "./types.js";

/**
 * Pure parsing of goir.ap.gov.in index rows.
 *
 * Kept free of Playwright so the tricky parts — date order, GO-number shapes,
 * the 30-day window — are testable without a browser or a live site.
 */

const GO_TYPES: Record<string, GoType> = {
  ms: "Ms",
  rt: "Rt",
  memo: "Memo",
  circular: "Circular",
};

/**
 * Indian government listings write dates little-endian: 01/04/2025 is 1 April,
 * never 4 January. Date.parse() would read that as a US date on some inputs and
 * silently shift every arrear calculation downstream, so parsing is explicit.
 */
const DATE_PATTERN = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/;

export function parseIssueDate(raw: string): string | null {
  const match = DATE_PATTERN.exec(raw.trim());
  if (match === null) return null;

  const [, dayStr, monthStr, yearStr] = match;
  const day = Number(dayStr);
  const month = Number(monthStr);
  const year = Number(yearStr);

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  // Round-trip through UTC to reject impossible days like 31/02/2025, which
  // would otherwise roll silently into March.
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Canonicalises the GO number as printed in the listing.
 *
 * Note: packages/rag has a similar-looking regex, but it solves a different
 * problem — finding a GO reference inside a user's free-text question. This one
 * normalises an already-structured field.
 */
export function parseGoNumber(raw: string): { goNumber: string; goType: GoType | null } | null {
  const text = raw.trim().replace(/\s+/g, " ");
  if (text === "") return null;

  const typed = /\bG\.?\s*O\.?\s*(Ms|Rt)\.?\s*No\.?\s*(\d{1,6})\b/i.exec(text);
  if (typed !== null) {
    const [, rawType, serial] = typed;
    const goType = GO_TYPES[(rawType ?? "").toLowerCase()] ?? null;
    return { goNumber: `G.O.${goType}.No.${Number(serial)}`, goType };
  }

  const memo = /\b(Memo|Circular)\b[^\d]{0,20}(\d{1,8})/i.exec(text);
  if (memo !== null) {
    const [, rawKind, serial] = memo;
    const goType = GO_TYPES[(rawKind ?? "").toLowerCase()] ?? null;
    return { goNumber: `${goType}.No.${Number(serial)}`, goType };
  }

  // Unrecognised shape: keep the text so a human can fix it in the review queue
  // rather than dropping the document.
  return { goNumber: text, goType: null };
}

/** True when `isoDate` falls within the last `days` days, inclusive of today. */
export function withinLastDays(isoDate: string, days: number, today: Date): boolean {
  const cutoff = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  cutoff.setUTCDate(cutoff.getUTCDate() - (days - 1));

  const value = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(value.getTime())) return false;

  const todayUtc = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  // A future-dated row is a data error on the site, not something to download.
  return value >= cutoff && value <= todayUtc;
}

export interface ParseOptions {
  /** Base URL used to absolutise hrefs. */
  baseUrl: string;
  /** Size of the window to keep. */
  days: number;
  today: Date;
}

export function parseIndexRows(rows: RawIndexRow[], options: ParseOptions): ParseResult {
  const entries: GoIndexEntry[] = [];
  const skipped: ParseResult["skipped"] = [];

  for (const row of rows) {
    const issueDate = parseIssueDate(row.issueDate);
    if (issueDate === null) {
      skipped.push({ row, reason: `unparseable date: ${JSON.stringify(row.issueDate)}` });
      continue;
    }

    if (!withinLastDays(issueDate, options.days, options.today)) {
      skipped.push({ row, reason: `outside the ${options.days}-day window (${issueDate})` });
      continue;
    }

    const parsedNumber = parseGoNumber(row.goNumber);
    if (parsedNumber === null) {
      skipped.push({ row, reason: "missing GO number" });
      continue;
    }

    let pdfUrl: string;
    try {
      pdfUrl = new URL(row.href, options.baseUrl).toString();
    } catch {
      skipped.push({ row, reason: `unusable link: ${JSON.stringify(row.href)}` });
      continue;
    }

    entries.push({
      goNumber: parsedNumber.goNumber,
      goType: parsedNumber.goType,
      department: row.department.trim().replace(/\s+/g, " "),
      issueDate,
      subject: row.subject.trim().replace(/\s+/g, " "),
      pdfUrl,
    });
  }

  return { entries, skipped };
}

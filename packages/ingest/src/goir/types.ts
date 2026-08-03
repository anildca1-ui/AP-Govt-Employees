/** GO types recognised by `documents.go_type` in migration 001. */
export type GoType = "Ms" | "Rt" | "Memo" | "Circular";

/**
 * A row as pulled off the index page, before any validation. Every field is a
 * raw string because that is all the DOM gives us.
 */
export interface RawIndexRow {
  goNumber: string;
  department: string;
  issueDate: string;
  subject: string;
  /** href as it appears in the markup; may be relative. */
  href: string;
}

/** A row that survived parsing and is ready to be queued. */
export interface GoIndexEntry {
  goNumber: string;
  goType: GoType | null;
  department: string;
  /** ISO calendar date, yyyy-mm-dd. */
  issueDate: string;
  subject: string;
  /** Absolute URL of the PDF. */
  pdfUrl: string;
}

export interface SkippedRow {
  row: RawIndexRow;
  reason: string;
}

export interface ParseResult {
  entries: GoIndexEntry[];
  skipped: SkippedRow[];
}

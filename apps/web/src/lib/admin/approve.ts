/**
 * The tested core of the approve action: turning an `ingest_queue` row into the
 * `documents` insert payload. Kept pure — no Supabase, no Next imports — so the
 * whole mapping matrix runs as plain unit tests.
 *
 * The meta jsonb is treated as untrusted input on purpose: the queue writer
 * fills go_number/go_type/dept/issue_date/subject/bytes from the scraped index
 * page, the metadata extractor later adds subject_te/supersedes/confidence/
 * needs_review/review_reasons, and rows forwarded via the bots may carry
 * neither. Approval must not crash on any of those shapes — anything invalid
 * degrades to null and the admin fixes it in the edit form instead.
 */

/** Mirrors the check constraint on documents.go_type in migration 001. */
export const GO_TYPES = ["Ms", "Rt", "Memo", "Circular"] as const;
export type GoType = (typeof GO_TYPES)[number];

/** The ingest_queue columns the admin UI reads (migration 001). */
export interface QueueRow {
  id: string;
  source: string;
  raw_url: string | null;
  file_path: string | null;
  sha256: string | null;
  status: "pending" | "processing" | "done" | "failed" | "duplicate";
  error: string | null;
  meta: unknown;
  created_at: string;
}

/** meta jsonb after validation — what the review UI and approval actually use. */
export interface QueueMeta {
  go_number: string | null;
  go_type: GoType | null;
  dept: string | null;
  issue_date: string | null;
  subject: string | null;
  subject_te: string | null;
  supersedes: string[];
  confidence: number | null;
  needs_review: boolean;
  review_reasons: string[];
  bytes: number | null;
  is_scanned: boolean | null;
  language: string | null;
}

/**
 * Insert payload for `documents`. is_scanned/language are optional rather than
 * nullable so an absent value falls through to the column defaults instead of
 * overwriting them with an explicit null (is_scanned defaults to false).
 */
export interface DocumentInsert {
  go_number: string | null;
  go_type: GoType | null;
  dept: string | null;
  issue_date: string | null;
  subject: string | null;
  subject_te: string | null;
  pdf_url: string | null;
  source: string;
  sha256: string;
  status: "approved";
  is_scanned?: boolean;
  language?: string;
}

function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Anything the check constraint would reject becomes null, not an insert error. */
export function asGoType(value: unknown): GoType | null {
  return typeof value === "string" && (GO_TYPES as readonly string[]).includes(value)
    ? (value as GoType)
    : null;
}

/**
 * Only strict yyyy-mm-dd passes through to the date column. Scraped dates
 * arrive as dd-mm-yyyy or free text often enough that letting Postgres guess
 * would silently store the wrong day; a dropped date is visible in review,
 * a wrong one is not.
 */
export function asIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  // Round-trip through Date so 2025-02-30 is dropped rather than rolled over.
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return null;
  return value;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "");
}

export function readQueueMeta(meta: unknown): QueueMeta {
  const m =
    meta !== null && typeof meta === "object" && !Array.isArray(meta)
      ? (meta as Record<string, unknown>)
      : {};
  return {
    go_number: asText(m.go_number),
    go_type: asGoType(m.go_type),
    dept: asText(m.dept),
    issue_date: asIsoDate(m.issue_date),
    subject: asText(m.subject),
    subject_te: asText(m.subject_te),
    supersedes: asStringArray(m.supersedes),
    confidence: typeof m.confidence === "number" ? m.confidence : null,
    needs_review: m.needs_review === true,
    review_reasons: asStringArray(m.review_reasons),
    bytes: typeof m.bytes === "number" ? m.bytes : null,
    is_scanned: typeof m.is_scanned === "boolean" ? m.is_scanned : null,
    language: asText(m.language),
  };
}

export function queueRowToDocument(row: QueueRow): DocumentInsert {
  // documents.sha256 is NOT NULL UNIQUE — it is the corpus-wide dedupe key, so
  // a row that was queued without a hash cannot be approved, only rejected.
  if (row.sha256 === null || row.sha256.trim() === "") {
    throw new Error(`queue row ${row.id} has no sha256 — cannot approve into documents`);
  }
  const meta = readQueueMeta(row.meta);
  return {
    go_number: meta.go_number,
    go_type: meta.go_type,
    dept: meta.dept,
    issue_date: meta.issue_date,
    subject: meta.subject,
    subject_te: meta.subject_te,
    pdf_url: row.raw_url,
    source: row.source,
    sha256: row.sha256,
    status: "approved",
    ...(meta.is_scanned === null ? {} : { is_scanned: meta.is_scanned }),
    ...(meta.language === null ? {} : { language: meta.language }),
  };
}

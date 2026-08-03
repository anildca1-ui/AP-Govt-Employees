import { parseGoNumber } from "../goir/parse.js";
import type { GoType } from "../goir/types.js";
import type { DocumentMetadata } from "../pipeline/types.js";

/**
 * Validates raw LLM output into a DocumentMetadata.
 *
 * Never throws: a garbled reply still has to reach the review queue as an
 * all-null, zero-confidence record (rule 6 — every document passes through
 * admin review), so every failure becomes a `problems` entry instead of an
 * exception that would drop the document.
 */

export interface ParsedExtraction {
  metadata: DocumentMetadata;
  problems: string[];
}

const GO_TYPES: Record<string, GoType> = {
  ms: "Ms",
  rt: "Rt",
  memo: "Memo",
  circular: "Circular",
};

export function parseExtraction(raw: string): ParsedExtraction {
  const block = extractJsonBlock(raw);
  if (block === null) {
    return {
      metadata: emptyMetadata(),
      problems: [`no JSON object found in the LLM reply: ${snippet(raw)}`],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(block);
  } catch {
    return {
      metadata: emptyMetadata(),
      problems: [`LLM reply is not valid JSON: ${snippet(block)}`],
    };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      metadata: emptyMetadata(),
      problems: [`LLM reply is not a JSON object: ${snippet(block)}`],
    };
  }
  const record = parsed as Record<string, unknown>;
  const problems: string[] = [];

  const goNumberRaw = asStringOrNull(record.go_number, "go_number", problems);
  // Canonicalise through the same routine the goir scraper uses, so the same
  // GO arriving via index page and via extraction dedupes to one spelling.
  // Unrecognised shapes are kept verbatim for a human to fix in review.
  const go_number =
    goNumberRaw === null ? null : (parseGoNumber(goNumberRaw)?.goNumber ?? goNumberRaw);

  const goTypeRaw = asStringOrNull(record.go_type, "go_type", problems);
  let go_type: GoType | null = null;
  if (goTypeRaw !== null) {
    go_type = GO_TYPES[goTypeRaw.toLowerCase()] ?? null;
    if (go_type === null) {
      problems.push(`go_type ${JSON.stringify(goTypeRaw)} is not one of Ms/Rt/Memo/Circular`);
    }
  }

  const issueDateRaw = asStringOrNull(record.issue_date, "issue_date", problems);
  let issue_date: string | null = null;
  if (issueDateRaw !== null) {
    issue_date = parseIsoDate(issueDateRaw);
    if (issue_date === null) {
      problems.push(`issue_date ${JSON.stringify(issueDateRaw)} is not a real yyyy-mm-dd date`);
    }
  }

  return {
    metadata: {
      go_number,
      go_type,
      dept: asStringOrNull(record.dept, "dept", problems),
      issue_date,
      subject: asStringOrNull(record.subject, "subject", problems),
      subject_te: asStringOrNull(record.subject_te, "subject_te", problems),
      supersedes: parseSupersedes(record.supersedes, problems),
      confidence: parseConfidence(record.confidence, problems),
    },
    problems,
  };
}

function emptyMetadata(): DocumentMetadata {
  return {
    go_number: null,
    go_type: null,
    dept: null,
    issue_date: null,
    subject: null,
    subject_te: null,
    supersedes: [],
    confidence: 0,
  };
}

/**
 * Finds the first balanced {...} block, so replies wrapped in markdown fences
 * or leading prose ("Here is the JSON: ...") still parse. Brace counting is
 * string-aware because subjects routinely contain braces-in-quotes.
 */
function extractJsonBlock(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw.charAt(i);
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = inString;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

function asStringOrNull(value: unknown, field: string, problems: string[]): string | null {
  // Absent and explicit null both mean "the model could not read it".
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    problems.push(`${field}: expected a string, got ${typeof value}`);
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

const ISO_DATE_PATTERN = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;

/**
 * Mirrors goir/parse.ts parseIssueDate: round-trip through UTC so an
 * impossible day like 2025-02-31 is rejected instead of rolling silently into
 * March, which Date.parse would happily do.
 */
function parseIsoDate(raw: string): string | null {
  const match = ISO_DATE_PATTERN.exec(raw.trim());
  if (match === null) return null;

  const [, yearStr, monthStr, dayStr] = match;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

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

function parseSupersedes(value: unknown, problems: string[]): string[] {
  // Absent is the common, legitimate case: most orders supersede nothing.
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) {
    problems.push(`supersedes: expected an array, got ${typeof value}`);
    return [];
  }

  const supersedes: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.trim() === "") {
      problems.push(`supersedes: dropped non-string entry ${JSON.stringify(entry)}`);
      continue;
    }
    // Same canonical spelling as go_number so the supersession linker in the
    // admin queue can match on plain string equality.
    supersedes.push(parseGoNumber(entry)?.goNumber ?? entry.trim());
  }
  return supersedes;
}

function parseConfidence(value: unknown, problems: string[]): number {
  let confidence: number;
  if (typeof value === "number") {
    confidence = value;
  } else if (typeof value === "string" && value.trim() !== "") {
    confidence = Number(value);
  } else {
    // Covers absent, null, "" and non-numeric types. Notably NOT Number(null),
    // which is 0 and would hide a missing confidence as a legitimate one.
    confidence = Number.NaN;
  }

  if (Number.isNaN(confidence)) {
    problems.push(`confidence ${JSON.stringify(value)} is not a number — treated as 0`);
    return 0;
  }
  return Math.min(1, Math.max(0, confidence));
}

function snippet(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 120 ? `${flat.slice(0, 120)}…` : flat;
}

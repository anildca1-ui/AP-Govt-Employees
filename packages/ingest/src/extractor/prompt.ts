/**
 * The metadata-extraction prompt, kept in ONE exported constant on purpose:
 * the Phase-1 review checkpoint (PLAN.md Part 5.1) is a human comparing 20
 * extractions against the real GOs and tuning the wording — that tuning must
 * touch exactly one place.
 */
export const EXTRACTION_PROMPT = `You are reading one Government Order (GO) issued by the Government of Andhra Pradesh, attached as a PDF. Extract its metadata.

Reply with a SINGLE JSON object and nothing else — no markdown fences, no commentary. It must have exactly these fields:

- "go_number": string | null — the order's own number as printed, e.g. "G.O.Ms.No.51" or "Memo.No.1234".
- "go_type": "Ms" | "Rt" | "Memo" | "Circular" | null — the kind of order; null if it is none of these four.
- "dept": string | null — the issuing department as printed on the order, e.g. "Finance (HR.I) Department".
- "issue_date": string | null — the order's date of issue, converted to ISO form yyyy-mm-dd (e.g. "2025-04-15").
- "subject": string | null — the order's subject line.
- "subject_te": string | null — a faithful Telugu rendering of the subject. If the order is English-only, translate the subject into Telugu yourself; if the order already states it in Telugu, use that wording.
- "supersedes": string[] — GO numbers that THIS order supersedes according to its own text. Cues include "in supersession of", "supersedes", "is hereby cancelled", and the Telugu "రద్దు". Do NOT list orders that are merely read, referenced or amended. Use [] when it supersedes nothing.
- "confidence": number — 0 to 1, your own honest confidence given the document's legibility. A clean typed order with every field clearly visible is near 1.0; a faint scan where you strained to read the number or date belongs well below 0.7. Do not inflate this.

Rules:
- Report only what the document itself says. If a field is absent or illegible, use null — NEVER guess or fill in from general knowledge.
- Dates on Indian government orders are written day-first (15/04/2025 is 15 April); convert carefully to yyyy-mm-dd.`;

/**
 * Assembles the final prompt for one document. Stage-1 text, when present,
 * rides along to spare the model re-reading clean pages — but it is marked
 * non-authoritative because text extraction drops letterheads, stamps and
 * signatures that the attached PDF still shows.
 */
export function buildExtractionPrompt(text?: string): string {
  if (text === undefined || text.trim() === "") return EXTRACTION_PROMPT;
  return `${EXTRACTION_PROMPT}

Extracted page text follows (it may be incomplete — the attached PDF is authoritative):

${text}`;
}

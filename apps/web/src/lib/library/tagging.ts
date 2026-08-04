import type { DocumentRow } from "./queries";

/**
 * Topic tags for the news feed (PLAN.md Phase 5: "tagged
 * DA/PRC/Transfers/EHS/Exams").
 *
 * Keyword matching over the subject, not an LLM call. Tagging thirty documents
 * a day through a model would cost real money and latency to reproduce what a
 * dozen keywords already get right, and — more to the point — a wrong tag from
 * a deterministic rule is debuggable, while a wrong tag from a model is not.
 */

export const NEWS_TAGS = ["DA", "PRC", "Transfers", "EHS", "Exams", "Pension", "Leave"] as const;
export type NewsTag = (typeof NEWS_TAGS)[number];

/**
 * Patterns per tag, in both scripts.
 *
 * Telugu terms are included because subject_te is often the only field filled
 * for a Telugu-language GO, and an English-only matcher would tag none of them.
 *
 * Note the absence of a \b around the whole alternation. JavaScript's \b is
 * defined over ASCII word characters, so there is no word boundary before a
 * Telugu letter — a leading \b silently prevents every Telugu term from ever
 * matching. Word boundaries appear only inside the ASCII alternatives, where
 * they do what they look like they do.
 */
const PATTERNS: Record<NewsTag, RegExp> = {
  DA: /(\bdearness\s+allowance\b|\bDA\b|కరువు\s*భత్యం)/i,
  PRC: /(\bpay\s+revision\b|\bPRC\b|\brevised\s+scales?\s+of\s+pay\b|\bRPS[-\s]?\d{4}\b|వేతన\s*సవరణ)/i,
  Transfers: /(\btransfers?\b|\bpostings?\b|\bdeputation\b|బదిలీ|పోస్టింగ్)/i,
  EHS: /(\bEHS\b|\bemployee\s+health\b|\bmedical\s+reimbursement\b|ఆరోగ్య)/i,
  Exams: /(\bdepartmental\s+test\b|\bexaminations?\b|\bEOT\b|\bGOT\b|పరీక్ష)/i,
  Pension: /(\bpension(?:ers?)?\b|\bgratuity\b|\bcommutation\b|\bGPS\b|\bCPS\b|\bNPS\b|పెన్షన్|గ్రాట్యుటీ)/i,
  Leave: /(\bleave\b|\bencashment\b|\bsurrender\b|సెలవు)/i,
};

/**
 * Tags for a document. A GO can carry several — a DA order is often also a
 * pension order, since pensioners get the same revision.
 */
export function tagsFor(document: Pick<DocumentRow, "subject" | "subject_te">): NewsTag[] {
  const haystack = `${document.subject ?? ""} ${document.subject_te ?? ""}`;
  if (haystack.trim() === "") return [];

  return NEWS_TAGS.filter((tag) => PATTERNS[tag].test(haystack));
}

/** Groups documents under a tag, for a filtered feed. */
export function filterByTag(documents: DocumentRow[], tag: NewsTag | null): DocumentRow[] {
  if (tag === null) return documents;
  return documents.filter((document) => tagsFor(document).includes(tag));
}

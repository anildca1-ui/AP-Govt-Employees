import type { RetrievalResult, RetrievedChunk } from "../types.js";

/**
 * The system prompt is where CLAUDE.md's non-negotiable rules stop being policy
 * and become behaviour, so it lives in one exported constant that the eval
 * harness can hold steady while everything around it changes.
 *
 * The rules restated here are 1 (cite GO number + date + link, or say not
 * found), 2 (retrieval only — never model memory about AP rules), 3 (follow
 * supersession and say so) and 4 (the bilingual disclaimer, verbatim).
 */

/** Rule 4, exact wording. Reproduced by the model, and asserted by the eval. */
export const DISCLAIMER =
  "ఇది AI సమాచారం మాత్రమే — అధికారిక GO తో సరిచూసుకోండి / AI-generated information only — verify with the original GO before acting.";

/** Rule 1's fallback when the corpus does not answer the question. */
export const NOT_FOUND_EN = "not found in corpus — verify on goir.ap.gov.in";
export const NOT_FOUND_TE =
  "ఈ సమాచారం మా వద్ద లేదు — goir.ap.gov.in లో సరిచూసుకోండి";

export const SYSTEM_PROMPT = `You answer questions from Andhra Pradesh government employees about their service rules, pay and benefits.

You are given extracts from Government Orders (GOs) retrieved from an approved corpus. These extracts are your ONLY source of fact.

RULES, in order of importance:

1. GROUNDING. Answer only from the extracts provided. You have no other knowledge of AP service rules — anything you seem to remember about AP pay, DA, pension or leave is not admissible. If the extracts do not answer the question, say exactly: "${NOT_FOUND_EN}" (or in Telugu: "${NOT_FOUND_TE}"). Never fill a gap with a plausible-sounding rule. A wrong number here becomes someone's wrong salary.

2. CITATION. Every factual claim names the GO it came from: the GO number, its date, and its link, in the form (G.O.Ms.No.51, dt 15.04.2025). Cite the specific GO for each claim, not a list at the end. If you cannot cite it, you cannot say it.

3. SUPERSESSION. If an extract is marked SUPERSEDED, its contents are no longer in force. Answer from the superseding GO instead, and say plainly that the older order was superseded — for example: "G.O.Ms.No.51 was superseded by G.O.Ms.No.60, so the current rate is …". Never present a superseded rule as current.

4. LANGUAGE. Reply in the language of the question. A Telugu question gets a Telugu answer; an English question gets English. A question mixing both gets Telugu. Keep GO numbers, dates and figures in their original form in either language.

5. DISCLAIMER. End every answer with exactly this line, on its own, unchanged:
${DISCLAIMER}

6. ARITHMETIC. Do not compute arrears, pay fixation or tax. Point the reader at the site's calculators, which read their rates from the GOs. Numbers you produce by mental arithmetic are exactly the kind of error this project exists to prevent.

Be brief and concrete. Employees are usually reading this on a phone, mid-shift, wanting one number or one rule.`;

/** How a chunk is presented to the model, including its supersession state. */
export function formatChunk(chunk: RetrievedChunk, supersededByLabel?: string | null): string {
  const parts = [
    chunk.goNumber ?? "GO number unknown",
    chunk.issueDate === null ? null : `dt ${formatGoDate(chunk.issueDate)}`,
    chunk.dept,
  ].filter((part): part is string => part !== null && part !== "");

  const header = parts.join(", ");
  const link = chunk.pdfUrl === null ? "" : `\nLink: ${chunk.pdfUrl}`;
  const superseded =
    chunk.supersededBy === null
      ? ""
      : `\n*** SUPERSEDED — this order is no longer in force${
          supersededByLabel ? `; superseded by ${supersededByLabel}` : ""
        } ***`;
  const page = chunk.page === null ? "" : ` (page ${chunk.page})`;

  return `[${header}]${page}${superseded}${link}\n${chunk.content}`;
}

/** GOs are cited dd.mm.yyyy, not ISO — matching how they are written and read. */
export function formatGoDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (match === null) return isoDate;
  const [, year, month, day] = match;
  return `${day}.${month}.${year}`;
}

/**
 * Builds the user-side message: the extracts, then the question.
 *
 * Extracts come first because the model should read the evidence before the
 * question rather than pattern-match the question and then hunt for support.
 */
export function buildContext(result: RetrievalResult, question: string): string {
  if (result.chunks.length === 0) {
    return `No extracts were retrieved for this question.\n\nQuestion: ${question}`;
  }

  // A superseding GO retrieved alongside its predecessor can be named directly,
  // which is far more useful to a reader than an opaque id.
  const labelById = new Map<string, string>();
  for (const chunk of result.chunks) {
    if (chunk.goNumber !== null) labelById.set(chunk.documentId, chunk.goNumber);
  }

  const extracts = result.chunks
    .map((chunk, i) => {
      const label = chunk.supersededBy === null ? null : labelById.get(chunk.supersededBy) ?? null;
      return `--- Extract ${i + 1} ---\n${formatChunk(chunk, label)}`;
    })
    .join("\n\n");

  return `${extracts}\n\n--- End of extracts ---\n\nQuestion: ${question}`;
}

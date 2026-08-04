/**
 * Scoring for the golden-set eval (PLAN.md Phase 2).
 *
 * These are deterministic checks over an answer's text, not a model judging a
 * model. The rules being tested — cite a GO, follow supersession, end with the
 * disclaimer, do not invent — are mechanically checkable, and a grader that is
 * itself an LLM would fail in exactly the situations that matter most.
 */

import { DISCLAIMER, NOT_FOUND_EN, NOT_FOUND_TE } from "../answer/prompt.js";

/** One golden case, as stored in tests/golden.jsonl. */
export interface GoldenCase {
  id: string;
  lang: "te" | "en";
  question: string;
  /**
   * GO numbers the answer must cite. Empty means the corpus cannot answer this
   * and the answer must say so rather than improvise.
   */
  expectCitations: string[];
  /** Substrings the answer must contain, e.g. a rate or a rule phrase. */
  expectContains?: string[];
  /**
   * Substrings that must NOT appear — usually a superseded figure the model
   * might otherwise present as current.
   */
  expectAbsent?: string[];
  /** True when the answer must state that an order was superseded. */
  expectSupersession?: boolean;
  notes?: string;
}

export interface CaseScore {
  id: string;
  passed: boolean;
  cited: boolean;
  grounded: boolean;
  disclaimer: boolean;
  languageOk: boolean;
  failures: string[];
}

export interface EvalSummary {
  total: number;
  passed: number;
  citeRate: number;
  groundedRate: number;
  disclaimerRate: number;
  languageRate: number;
  scores: CaseScore[];
}

/** Matches a citation of the form G.O.Ms.No.51 / GO Rt No 1234 / Memo No 55. */
const CITATION_PATTERN =
  /\b(?:G\.?\s*O\.?\s*(?:Ms|Rt)\.?\s*No\.?\s*\d{1,6}|(?:Memo|Circular)\.?\s*No\.?\s*\d{1,8})/i;

/** Punctuation-insensitive comparison, matching chunks_for_go_number's SQL. */
function squeeze(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function citesAnyGo(answer: string): boolean {
  return CITATION_PATTERN.test(answer);
}

export function citesAll(answer: string, expected: string[]): boolean {
  const squeezed = squeeze(answer);
  return expected.every((go) => squeezed.includes(squeeze(go)));
}

/** Telugu script, used to check the answer came back in the asked language. */
const TELUGU = /[ఀ-౿]/;

export function answeredInLanguage(answer: string, lang: "te" | "en"): boolean {
  // The disclaimer is bilingual by design, so it would make any answer look
  // Telugu. Strip it before judging the language of the answer itself.
  const body = answer.replace(DISCLAIMER, "").trim();
  if (body === "") return false;
  const hasTelugu = TELUGU.test(body);
  // English answers legitimately quote Telugu subjects, so an English answer is
  // judged on whether it is *mostly* Latin rather than free of Telugu.
  if (lang === "te") return hasTelugu;
  const teluguChars = (body.match(/[ఀ-౿]/g) ?? []).length;
  return teluguChars / body.length < 0.2;
}

export function saysNotFound(answer: string): boolean {
  return answer.includes(NOT_FOUND_EN) || answer.includes(NOT_FOUND_TE);
}

export function hasDisclaimer(answer: string): boolean {
  return answer.includes(DISCLAIMER);
}

export function scoreCase(golden: GoldenCase, answer: string): CaseScore {
  const failures: string[] = [];

  const expectsCitations = golden.expectCitations.length > 0;

  // Rule 1 has two halves: cite, or say plainly that the corpus does not know.
  const cited = expectsCitations ? citesAll(answer, golden.expectCitations) : saysNotFound(answer);
  if (!cited) {
    failures.push(
      expectsCitations
        ? `missing citation(s): ${golden.expectCitations.join(", ")}`
        : "should have said the answer is not in the corpus",
    );
  }

  // A case with no expected citations must not invent one either.
  if (!expectsCitations && citesAnyGo(answer)) {
    failures.push("cited a GO for a question the corpus cannot answer");
  }

  let grounded = true;
  for (const needle of golden.expectContains ?? []) {
    if (!answer.includes(needle)) {
      failures.push(`missing expected content: ${JSON.stringify(needle)}`);
      grounded = false;
    }
  }
  for (const needle of golden.expectAbsent ?? []) {
    if (answer.includes(needle)) {
      failures.push(`contains content that should be absent: ${JSON.stringify(needle)}`);
      grounded = false;
    }
  }
  if (golden.expectSupersession === true && !/supersed|రద్దు/i.test(answer)) {
    failures.push("did not state that the earlier GO was superseded");
    grounded = false;
  }

  const disclaimer = hasDisclaimer(answer);
  if (!disclaimer) failures.push("missing the bilingual disclaimer");

  const languageOk = answeredInLanguage(answer, golden.lang);
  if (!languageOk) failures.push(`answer was not in ${golden.lang}`);

  return {
    id: golden.id,
    passed: failures.length === 0,
    cited,
    grounded,
    disclaimer,
    languageOk,
    failures,
  };
}

export function summarise(scores: CaseScore[]): EvalSummary {
  const total = scores.length;
  const rate = (n: number) => (total === 0 ? 0 : n / total);

  return {
    total,
    passed: scores.filter((s) => s.passed).length,
    citeRate: rate(scores.filter((s) => s.cited).length),
    groundedRate: rate(scores.filter((s) => s.grounded).length),
    disclaimerRate: rate(scores.filter((s) => s.disclaimer).length),
    languageRate: rate(scores.filter((s) => s.languageOk).length),
    scores,
  };
}

/** PLAN.md Phase 2: CI fails below a 90% cite rate. */
export const CITE_RATE_THRESHOLD = 0.9;

export function parseGoldenJsonl(text: string): GoldenCase[] {
  const cases: GoldenCase[] = [];
  text.split("\n").forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("//")) return;
    let parsed: GoldenCase;
    try {
      parsed = JSON.parse(trimmed) as GoldenCase;
    } catch {
      throw new Error(`golden.jsonl line ${index + 1} is not valid JSON`);
    }
    if (!parsed.id || !parsed.question || !Array.isArray(parsed.expectCitations)) {
      throw new Error(`golden.jsonl line ${index + 1} is missing id, question or expectCitations`);
    }
    cases.push(parsed);
  });
  return cases;
}

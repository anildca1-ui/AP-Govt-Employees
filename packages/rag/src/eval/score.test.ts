import { describe, expect, it } from "vitest";
import { DISCLAIMER, NOT_FOUND_EN, NOT_FOUND_TE } from "../answer/prompt.js";
import {
  answeredInLanguage,
  citesAll,
  citesAnyGo,
  parseGoldenJsonl,
  scoreCase,
  summarise,
  type GoldenCase,
} from "./score.js";

const GOOD_ANSWER = `The current DA is 37.31% (G.O.Ms.No.60, dt 20.10.2025).\n${DISCLAIMER}`;

function golden(overrides: Partial<GoldenCase> = {}): GoldenCase {
  return {
    id: "t1",
    lang: "en",
    question: "What is the current DA?",
    expectCitations: ["G.O.Ms.No.60"],
    ...overrides,
  };
}

describe("citesAnyGo", () => {
  it("recognises the citation forms the corpus uses", () => {
    for (const text of [
      "per G.O.Ms.No.60",
      "see GO Rt No 1234",
      "G.O.Rt.No.9",
      "Memo No. 12345",
      "Circular No.77",
    ]) {
      expect(citesAnyGo(text), text).toBe(true);
    }
  });

  it("does not mistake a bare number for a citation", () => {
    expect(citesAnyGo("the rate is 37.31 percent as of 2025")).toBe(false);
    expect(citesAnyGo(NOT_FOUND_EN)).toBe(false);
  });
});

describe("citesAll", () => {
  it("matches regardless of how the number is punctuated", () => {
    // The model may write "GO Ms No 60" where the golden set says "G.O.Ms.No.60".
    expect(citesAll("per GO Ms No 60 dated 20.10.2025", ["G.O.Ms.No.60"])).toBe(true);
    expect(citesAll("per G.O.Ms.No.60", ["GO Ms No 60"])).toBe(true);
  });

  it("fails when one of several required GOs is missing", () => {
    expect(citesAll("per G.O.Ms.No.60", ["G.O.Ms.No.60", "G.O.Ms.No.1"])).toBe(false);
  });
});

describe("answeredInLanguage", () => {
  it("accepts a Telugu answer to a Telugu question", () => {
    expect(answeredInLanguage(`ప్రస్తుత డీఏ 37.31%.\n${DISCLAIMER}`, "te")).toBe(true);
  });

  it("rejects an English answer to a Telugu question", () => {
    // The disclaimer is bilingual, so it must not be what makes this pass.
    expect(answeredInLanguage(`The current DA is 37.31%.\n${DISCLAIMER}`, "te")).toBe(false);
  });

  it("accepts an English answer that quotes a Telugu subject line", () => {
    const answer = `The subject reads "కరువు భత్యం" and the rate is 37.31%. ${DISCLAIMER}`;
    expect(answeredInLanguage(answer, "en")).toBe(true);
  });

  it("rejects an answer that is only the disclaimer", () => {
    expect(answeredInLanguage(DISCLAIMER, "te")).toBe(false);
  });
});

describe("scoreCase", () => {
  it("passes a well-formed answer", () => {
    const score = scoreCase(golden(), GOOD_ANSWER);

    expect(score.passed).toBe(true);
    expect(score.failures).toEqual([]);
  });

  it("fails an answer with no citation", () => {
    const score = scoreCase(golden(), `The current DA is 37.31%.\n${DISCLAIMER}`);

    expect(score.cited).toBe(false);
    expect(score.failures.join(" ")).toMatch(/missing citation/);
  });

  it("fails an answer missing the disclaimer (rule 4)", () => {
    const score = scoreCase(golden(), "The current DA is 37.31% (G.O.Ms.No.60).");

    expect(score.disclaimer).toBe(false);
    expect(score.passed).toBe(false);
  });

  it("requires a not-found answer when the corpus cannot answer", () => {
    const unanswerable = golden({ expectCitations: [] });

    expect(scoreCase(unanswerable, `${NOT_FOUND_EN}\n${DISCLAIMER}`).cited).toBe(true);
    expect(scoreCase(unanswerable, `Paris is the capital.\n${DISCLAIMER}`).cited).toBe(false);
  });

  it("catches a fabricated citation on an unanswerable question", () => {
    // The most dangerous failure mode: inventing a GO number that looks real.
    const score = scoreCase(
      golden({ expectCitations: [] }),
      `The rule is in G.O.Ms.No.123 (dt 01.01.2020).\n${DISCLAIMER}`,
    );

    expect(score.passed).toBe(false);
    expect(score.failures.join(" ")).toMatch(/cited a GO for a question the corpus cannot answer/);
  });

  it("accepts the Telugu not-found wording too", () => {
    const score = scoreCase(
      golden({ expectCitations: [], lang: "te" }),
      `${NOT_FOUND_TE}\n${DISCLAIMER}`,
    );
    expect(score.cited).toBe(true);
  });

  it("checks required and forbidden content", () => {
    const spec = golden({ expectContains: ["37.31"], expectAbsent: ["33.67"] });

    expect(scoreCase(spec, GOOD_ANSWER).grounded).toBe(true);
    expect(
      scoreCase(spec, `DA is 33.67% (G.O.Ms.No.60).\n${DISCLAIMER}`).failures.join(" "),
    ).toMatch(/should be absent/);
  });

  it("requires supersession to be stated when the case demands it (rule 3)", () => {
    const spec = golden({ expectSupersession: true });

    expect(scoreCase(spec, GOOD_ANSWER).grounded).toBe(false);
    expect(
      scoreCase(
        spec,
        `G.O.Ms.No.30 was superseded by G.O.Ms.No.60, so the rate is 37.31%.\n${DISCLAIMER}`,
      ).grounded,
    ).toBe(true);
  });

  it("accepts the Telugu word for superseded", () => {
    const spec = golden({ expectSupersession: true, lang: "te" });
    const answer = `పాత జీవో రద్దు చేయబడింది; ప్రస్తుత రేటు 37.31% (G.O.Ms.No.60).\n${DISCLAIMER}`;

    expect(scoreCase(spec, answer).grounded).toBe(true);
  });
});

describe("summarise", () => {
  it("reports the rates the CI gate reads", () => {
    const summary = summarise([
      scoreCase(golden({ id: "a" }), GOOD_ANSWER),
      scoreCase(golden({ id: "b" }), `No citation here.\n${DISCLAIMER}`),
    ]);

    expect(summary.total).toBe(2);
    expect(summary.passed).toBe(1);
    expect(summary.citeRate).toBe(0.5);
    expect(summary.disclaimerRate).toBe(1);
  });

  it("does not divide by zero on an empty run", () => {
    expect(summarise([]).citeRate).toBe(0);
  });
});

describe("parseGoldenJsonl", () => {
  it("skips comments and blank lines", () => {
    const text = [
      "// a comment",
      "",
      JSON.stringify({ id: "a", lang: "en", question: "q", expectCitations: [] }),
    ].join("\n");

    expect(parseGoldenJsonl(text)).toHaveLength(1);
  });

  it("names the line when one is malformed", () => {
    expect(() => parseGoldenJsonl("// c\n{not json}")).toThrow(/line 2/);
  });

  it("rejects a case missing required fields", () => {
    expect(() => parseGoldenJsonl('{"id":"a"}')).toThrow(/missing id, question or expectCitations/);
  });
});

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseGoldenJsonl } from "./score.js";

/**
 * Guards the golden set itself.
 *
 * The eval is only as good as its cases, and a malformed or lopsided golden
 * file fails quietly: it still runs, still reports a percentage, and that
 * percentage means nothing. These checks run in the normal test suite so the
 * set cannot rot between eval runs.
 */

// Anchored to this file, not to cwd: the root runner and a per-package run
// have different working directories, and cwd-relative resolution silently
// picks a different (or missing) file depending on how the suite was invoked.
const here = dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = join(here, "..", "..", "..", "..", "tests", "golden.jsonl");
const cases = parseGoldenJsonl(readFileSync(GOLDEN_PATH, "utf8"));

describe("golden.jsonl", () => {
  it("has the 30 pairs PLAN.md Phase 2 asks for", () => {
    expect(cases).toHaveLength(30);
  });

  it("covers both languages substantially", () => {
    const telugu = cases.filter((c) => c.lang === "te").length;
    const english = cases.filter((c) => c.lang === "en").length;

    // Telugu is the default UI, so it cannot be a token presence in the eval.
    expect(telugu).toBeGreaterThanOrEqual(10);
    expect(english).toBeGreaterThanOrEqual(10);
    expect(telugu + english).toBe(cases.length);
  });

  it("uses unique ids, so a failure names one case", () => {
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
  });

  it("asks Telugu questions in Telugu script", () => {
    for (const c of cases.filter((x) => x.lang === "te")) {
      expect(c.question, c.id).toMatch(/[ఀ-౿]/);
    }
  });

  it("includes cases the corpus cannot answer", () => {
    // Without these the eval only measures recall and never catches invention,
    // which is the failure mode that actually harms someone.
    const unanswerable = cases.filter((c) => c.expectCitations.length === 0);
    expect(unanswerable.length).toBeGreaterThanOrEqual(5);
  });

  it("includes traps for a fabricated GO and for out-of-scope questions", () => {
    const ids = cases.map((c) => c.id).join(" ");
    expect(ids).toMatch(/fake-go/);
    expect(ids).toMatch(/out-of-scope/);
  });

  it("includes a supersession case, which rule 3 exists for", () => {
    expect(cases.some((c) => c.expectSupersession === true)).toBe(true);
  });

  it("includes an arithmetic refusal case", () => {
    // The prompt sends calculations to the calculators; the eval must check it.
    expect(cases.some((c) => c.id.startsWith("arithmetic"))).toBe(true);
  });

  it("exercises the GO-number short-circuit", () => {
    expect(cases.some((c) => /G\.O\.Ms\.No\.\d+/.test(c.question))).toBe(true);
  });

  it("never expects content it also forbids", () => {
    for (const c of cases) {
      const contains = new Set(c.expectContains ?? []);
      for (const absent of c.expectAbsent ?? []) {
        expect(contains.has(absent), `${c.id} both requires and forbids ${absent}`).toBe(false);
      }
    }
  });
});

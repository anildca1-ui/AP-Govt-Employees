import { describe, expect, it } from "vitest";
import { buildExtractionPrompt, EXTRACTION_PROMPT } from "./prompt.js";

/**
 * Guards the prompt's contract, not its prose: the wording is expected to be
 * tuned at the Phase-1 review checkpoint (PLAN.md Part 5.1), but every
 * DocumentMetadata field and the core rules must survive that tuning.
 */
describe("EXTRACTION_PROMPT", () => {
  it("names every DocumentMetadata field", () => {
    for (const field of [
      "go_number",
      "go_type",
      "dept",
      "issue_date",
      "subject",
      "subject_te",
      "supersedes",
      "confidence",
    ]) {
      expect(EXTRACTION_PROMPT).toContain(`"${field}"`);
    }
  });

  it("pins the load-bearing rules", () => {
    // Unknown means null, never a guess (quality rule 2: no model memory).
    expect(EXTRACTION_PROMPT).toMatch(/NEVER guess/);
    expect(EXTRACTION_PROMPT).toContain("yyyy-mm-dd");
    // Supersession cues, including the Telugu one.
    expect(EXTRACTION_PROMPT).toContain("in supersession of");
    expect(EXTRACTION_PROMPT).toContain("రద్దు");
    // The four go_type values the schema accepts.
    expect(EXTRACTION_PROMPT).toMatch(/"Ms" \| "Rt" \| "Memo" \| "Circular"/);
  });
});

describe("buildExtractionPrompt", () => {
  it("returns the bare prompt when there is no extracted text", () => {
    expect(buildExtractionPrompt()).toBe(EXTRACTION_PROMPT);
    expect(buildExtractionPrompt("")).toBe(EXTRACTION_PROMPT);
    expect(buildExtractionPrompt("   \n")).toBe(EXTRACTION_PROMPT);
  });

  it("appends extracted text after the task, marked non-authoritative", () => {
    const prompt = buildExtractionPrompt("G.O.Ms.No.51 Dated:15-04-2025");

    expect(prompt.startsWith(EXTRACTION_PROMPT)).toBe(true);
    expect(prompt).toContain("G.O.Ms.No.51 Dated:15-04-2025");
    expect(prompt).toContain("the attached PDF is authoritative");
  });
});

import { describe, expect, it } from "vitest";
import { parseExtraction } from "./parse.js";

/** A reply with every field present and well-formed. */
const CLEAN = {
  go_number: "G.O.Ms.No.51",
  go_type: "Ms",
  dept: "Finance",
  issue_date: "2025-04-15",
  subject: "Dearness Allowance to State Government Employees",
  subject_te: "రాష్ట్ర ప్రభుత్వ ఉద్యోగులకు కరవు భత్యం",
  supersedes: ["G.O.Ms.No.27"],
  confidence: 0.95,
};

describe("parseExtraction", () => {
  it("accepts clean JSON with no problems", () => {
    const { metadata, problems } = parseExtraction(JSON.stringify(CLEAN));

    expect(problems).toEqual([]);
    expect(metadata).toEqual(CLEAN);
  });

  it("tolerates markdown fences around the JSON", () => {
    const raw = "```json\n" + JSON.stringify(CLEAN) + "\n```";
    const { metadata, problems } = parseExtraction(raw);

    expect(problems).toEqual([]);
    expect(metadata.go_number).toBe("G.O.Ms.No.51");
  });

  it("tolerates leading and trailing prose around the JSON", () => {
    const raw = `Here is the metadata I could read:\n\n${JSON.stringify(CLEAN)}\n\nLet me know if you need anything else.`;
    const { metadata, problems } = parseExtraction(raw);

    expect(problems).toEqual([]);
    expect(metadata.subject).toBe(CLEAN.subject);
  });

  it("nulls an unrecognised go_type and records a problem", () => {
    const { metadata, problems } = parseExtraction(
      JSON.stringify({ ...CLEAN, go_type: "Gazette" }),
    );

    expect(metadata.go_type).toBeNull();
    expect(problems).toEqual([expect.stringMatching(/go_type.*Ms\/Rt\/Memo\/Circular/)]);
  });

  it("canonicalises go_type casing rather than rejecting it", () => {
    const { metadata, problems } = parseExtraction(JSON.stringify({ ...CLEAN, go_type: "ms" }));

    expect(metadata.go_type).toBe("Ms");
    expect(problems).toEqual([]);
  });

  it("rejects an impossible calendar date instead of letting it roll over", () => {
    // Date.parse would silently turn 2025-02-31 into 3 March; a wrong issue
    // date poisons supersession ordering downstream, so it must become null.
    const { metadata, problems } = parseExtraction(
      JSON.stringify({ ...CLEAN, issue_date: "2025-02-31" }),
    );

    expect(metadata.issue_date).toBeNull();
    expect(problems).toEqual([expect.stringMatching(/issue_date.*2025-02-31/)]);
  });

  it("keeps a real leap-year date", () => {
    const { metadata, problems } = parseExtraction(
      JSON.stringify({ ...CLEAN, issue_date: "2024-02-29" }),
    );

    expect(metadata.issue_date).toBe("2024-02-29");
    expect(problems).toEqual([]);
  });

  it("rejects a date that is not yyyy-mm-dd", () => {
    const { metadata, problems } = parseExtraction(
      JSON.stringify({ ...CLEAN, issue_date: "15/04/2025" }),
    );

    expect(metadata.issue_date).toBeNull();
    expect(problems).toHaveLength(1);
  });

  it("canonicalises a loosely-spelled GO number", () => {
    const { metadata } = parseExtraction(
      JSON.stringify({ ...CLEAN, go_number: "G.O. Ms. No. 051" }),
    );

    expect(metadata.go_number).toBe("G.O.Ms.No.51");
  });

  it("keeps an unrecognised GO-number shape verbatim for the reviewer", () => {
    const { metadata } = parseExtraction(
      JSON.stringify({ ...CLEAN, go_number: "Proc.Rc.No.114/2025" }),
    );

    expect(metadata.go_number).toBe("Proc.Rc.No.114/2025");
  });

  it("canonicalises supersedes entries and drops non-strings with a problem", () => {
    const { metadata, problems } = parseExtraction(
      JSON.stringify({ ...CLEAN, supersedes: ["G.O. Ms. No. 27", 42, ""] }),
    );

    expect(metadata.supersedes).toEqual(["G.O.Ms.No.27"]);
    expect(problems).toEqual([
      expect.stringMatching(/supersedes.*42/),
      expect.stringMatching(/supersedes/),
    ]);
  });

  it("treats a non-array supersedes as empty with a problem", () => {
    const { metadata, problems } = parseExtraction(
      JSON.stringify({ ...CLEAN, supersedes: "G.O.Ms.No.27" }),
    );

    expect(metadata.supersedes).toEqual([]);
    expect(problems).toEqual([expect.stringMatching(/supersedes.*expected an array/)]);
  });

  it("clamps confidence into [0, 1]", () => {
    expect(parseExtraction(JSON.stringify({ ...CLEAN, confidence: 1.4 })).metadata.confidence).toBe(1);
    expect(parseExtraction(JSON.stringify({ ...CLEAN, confidence: -0.2 })).metadata.confidence).toBe(0);
  });

  it("turns a missing or non-numeric confidence into 0 with a problem", () => {
    const missing = parseExtraction(JSON.stringify({ ...CLEAN, confidence: undefined }));
    expect(missing.metadata.confidence).toBe(0);
    expect(missing.problems).toEqual([expect.stringMatching(/confidence/)]);

    const wordy = parseExtraction(JSON.stringify({ ...CLEAN, confidence: "high" }));
    expect(wordy.metadata.confidence).toBe(0);
    expect(wordy.problems).toEqual([expect.stringMatching(/confidence/)]);
  });

  it("treats explicit nulls as unknowns without complaint", () => {
    const { metadata, problems } = parseExtraction(
      JSON.stringify({ ...CLEAN, dept: null, subject_te: null }),
    );

    expect(metadata.dept).toBeNull();
    expect(metadata.subject_te).toBeNull();
    expect(problems).toEqual([]);
  });

  it("never throws on garbage — the document must still reach review", () => {
    const { metadata, problems } = parseExtraction("I could not read this document at all.");

    expect(metadata).toEqual({
      go_number: null,
      go_type: null,
      dept: null,
      issue_date: null,
      subject: null,
      subject_te: null,
      supersedes: [],
      confidence: 0,
    });
    expect(problems).toEqual([expect.stringMatching(/no JSON object/)]);
  });

  it("never throws on truncated JSON", () => {
    const { metadata, problems } = parseExtraction('{"go_number": "G.O.Ms.No.51", "go_type"');

    expect(metadata.confidence).toBe(0);
    expect(metadata.go_number).toBeNull();
    expect(problems).toHaveLength(1);
  });

  it("never throws when the reply is a JSON array instead of an object", () => {
    const { metadata, problems } = parseExtraction("[1, 2, 3]");

    expect(metadata.confidence).toBe(0);
    expect(problems).toEqual([expect.stringMatching(/no JSON object/)]);
  });

  it("records a problem when a string field arrives as a number", () => {
    const { metadata, problems } = parseExtraction(JSON.stringify({ ...CLEAN, dept: 7 }));

    expect(metadata.dept).toBeNull();
    expect(problems).toEqual([expect.stringMatching(/dept.*expected a string/)]);
  });
});

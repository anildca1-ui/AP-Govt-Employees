import { describe, expect, it } from "vitest";
import {
  buildContext,
  DISCLAIMER,
  formatChunk,
  formatGoDate,
  NOT_FOUND_EN,
  SYSTEM_PROMPT,
} from "./prompt.js";
import type { RetrievalResult, RetrievedChunk } from "../types.js";

function chunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    chunkId: "c1",
    documentId: "d1",
    seq: 1,
    content: "Dearness Allowance enhanced to 37.31 percent.",
    page: 2,
    goNumber: "G.O.Ms.No.60",
    goType: "Ms",
    dept: "Finance",
    issueDate: "2025-10-20",
    subject: "DA",
    subjectTe: "కరువు భత్యం",
    pdfUrl: "https://goir.ap.gov.in/60.pdf",
    supersededBy: null,
    vectorScore: 0.9,
    keywordScore: 0.4,
    score: 0.7,
    ...overrides,
  };
}

function result(chunks: RetrievedChunk[]): RetrievalResult {
  return { mode: "hybrid", chunks, supersessions: [] };
}

describe("SYSTEM_PROMPT", () => {
  it("carries the disclaimer verbatim, since the model reproduces it (rule 4)", () => {
    expect(SYSTEM_PROMPT).toContain(DISCLAIMER);
  });

  it("gives the exact not-found wording rule 1 requires", () => {
    expect(SYSTEM_PROMPT).toContain(NOT_FOUND_EN);
    expect(SYSTEM_PROMPT).toContain("goir.ap.gov.in");
  });

  it("states each non-negotiable rule", () => {
    // If one of these is ever dropped from the prompt, the behaviour it
    // enforces disappears silently — the model simply stops doing it.
    expect(SYSTEM_PROMPT).toMatch(/GROUNDING/);
    expect(SYSTEM_PROMPT).toMatch(/CITATION/);
    expect(SYSTEM_PROMPT).toMatch(/SUPERSESSION/);
    expect(SYSTEM_PROMPT).toMatch(/LANGUAGE/);
    expect(SYSTEM_PROMPT).toMatch(/DISCLAIMER/);
  });

  it("forbids answering from model memory (rule 2)", () => {
    expect(SYSTEM_PROMPT).toMatch(/only from the extracts|ONLY source/i);
  });

  it("tells the model to answer Telugu questions in Telugu", () => {
    expect(SYSTEM_PROMPT).toMatch(/Telugu question gets a Telugu answer/i);
  });

  it("keeps the model out of arithmetic, which the calculators own", () => {
    expect(SYSTEM_PROMPT).toMatch(/Do not compute/i);
  });
});

describe("formatGoDate", () => {
  it("renders dates the way GOs are written and cited", () => {
    expect(formatGoDate("2025-10-20")).toBe("20.10.2025");
    expect(formatGoDate("2025-04-01")).toBe("01.04.2025");
  });

  it("passes through anything that is not an ISO date", () => {
    expect(formatGoDate("unknown")).toBe("unknown");
  });
});

describe("formatChunk", () => {
  it("puts the GO number, date, department and link where the model can cite them", () => {
    const text = formatChunk(chunk());

    expect(text).toContain("G.O.Ms.No.60");
    expect(text).toContain("dt 20.10.2025");
    expect(text).toContain("Finance");
    expect(text).toContain("https://goir.ap.gov.in/60.pdf");
    expect(text).toContain("page 2");
  });

  it("marks a superseded extract unmissably (rule 3)", () => {
    const text = formatChunk(chunk({ supersededBy: "newer" }), "G.O.Ms.No.99");

    expect(text).toContain("SUPERSEDED");
    expect(text).toContain("no longer in force");
    expect(text).toContain("superseded by G.O.Ms.No.99");
  });

  it("still marks supersession when the superseding GO was not retrieved", () => {
    const text = formatChunk(chunk({ supersededBy: "newer" }), null);

    expect(text).toContain("SUPERSEDED");
    expect(text).not.toContain("superseded by null");
  });

  it("does not claim supersession for a current order", () => {
    expect(formatChunk(chunk())).not.toContain("SUPERSEDED");
  });

  it("copes with a document whose metadata is incomplete", () => {
    const text = formatChunk(
      chunk({ goNumber: null, issueDate: null, dept: null, pdfUrl: null, page: null }),
    );

    expect(text).toContain("GO number unknown");
    expect(text).not.toContain("null");
  });
});

describe("buildContext", () => {
  it("puts the extracts before the question", () => {
    const context = buildContext(result([chunk()]), "DA ఎంత?");

    expect(context.indexOf("Extract 1")).toBeLessThan(context.indexOf("Question:"));
    expect(context).toContain("DA ఎంత?");
  });

  it("numbers every extract", () => {
    const context = buildContext(
      result([chunk({ chunkId: "a" }), chunk({ chunkId: "b" }), chunk({ chunkId: "c" })]),
      "q",
    );

    expect(context).toContain("Extract 1");
    expect(context).toContain("Extract 2");
    expect(context).toContain("Extract 3");
  });

  it("names the superseding GO when it was retrieved alongside", () => {
    const context = buildContext(
      result([
        chunk({ documentId: "old", goNumber: "G.O.Ms.No.51", supersededBy: "new" }),
        chunk({ chunkId: "c2", documentId: "new", goNumber: "G.O.Ms.No.60" }),
      ]),
      "current DA?",
    );

    expect(context).toContain("superseded by G.O.Ms.No.60");
  });

  it("says plainly when nothing was retrieved, so the model returns not-found", () => {
    const context = buildContext(result([]), "what is the moon made of");

    expect(context).toContain("No extracts were retrieved");
    expect(context).toContain("what is the moon made of");
  });
});

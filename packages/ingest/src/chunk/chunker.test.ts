import { describe, expect, it } from "vitest";
import type { ChunkInput } from "../pipeline/types.js";
import { chunkDocument } from "./chunker.js";

const HEADER: ChunkInput["header"] = {
  go_number: "G.O.Ms.No.51",
  dept: "Finance",
  issue_date: "2025-04-15",
  subject: "Dearness Allowance",
};
const HEADER_LINE = "[G.O.Ms.No.51 | Finance | 2025-04-15 | Dearness Allowance]";

function input(text: string, header: ChunkInput["header"] = HEADER): ChunkInput {
  return { text, header };
}

/** The chunk body without its provenance prefix, for structural assertions. */
function body(content: string): string {
  expect(content).toMatch(/^\[[^\]]+\] /);
  return content.replace(/^\[[^\]]+\] /, "");
}

// 35 chars each, so piece geometry under maxChars=100/overlap=40 is exact.
const SENTENCES = Array.from(
  { length: 9 },
  (_, i) => `Sentence ${i + 1} padded to a fixed width.`,
);

describe("chunkDocument", () => {
  it("splits at numbered paragraph starts even without blank lines", () => {
    const text =
      "1. First paragraph about the DA enhancement rates.\n" +
      "2. Second paragraph about arrears payment schedule.\n" +
      "3. Third paragraph.";
    const chunks = chunkDocument(input(text), { maxChars: 60, overlapChars: 10 });

    expect(chunks).toHaveLength(3);
    expect(body(chunks[0]!.content)).toBe("1. First paragraph about the DA enhancement rates.");
    expect(body(chunks[1]!.content)).toBe("2. Second paragraph about arrears payment schedule.");
    expect(body(chunks[2]!.content)).toBe("3. Third paragraph.");
  });

  it("does not split on years or 3-digit numbers at a line start", () => {
    const text = "Issued under Rule 5 of the code.\n2025. That year saw revisions.";
    const chunks = chunkDocument(input(text), { maxChars: 80, overlapChars: 10 });

    expect(chunks).toHaveLength(1);
    expect(body(chunks[0]!.content)).toContain("2025. That year saw revisions.");
  });

  it("splits on two-digit paragraph numbers", () => {
    const text = "11. Para eleven text.\n12. Para twelve text.";
    const chunks = chunkDocument(input(text), { maxChars: 30, overlapChars: 5 });

    expect(chunks).toHaveLength(2);
    expect(body(chunks[1]!.content)).toBe("12. Para twelve text.");
  });

  it("merges small adjacent paragraphs up to maxChars", () => {
    const text = "First short para.\n\nSecond short para.\n\nThird short para.";
    const chunks = chunkDocument(input(text));

    expect(chunks).toHaveLength(1);
    expect(body(chunks[0]!.content)).toBe(
      "First short para.\n\nSecond short para.\n\nThird short para.",
    );
  });

  it("keeps an ORDER heading in the same chunk as the paragraph it introduces", () => {
    const text = "Preamble paragraph.\n\nORDER:\n\nThe following orders are issued.";
    const chunks = chunkDocument(input(text), { maxChars: 45, overlapChars: 5 });

    expect(chunks).toHaveLength(2);
    expect(body(chunks[1]!.content)).toBe("ORDER:\nThe following orders are issued.");
    for (const chunk of chunks) {
      expect(body(chunk.content).endsWith("ORDER:")).toBe(false);
    }
  });

  it("keeps a numbered annexure heading with its following paragraph", () => {
    const text = "Covering para of the order.\n\nANNEXURE-I\n\nScale details for the annexure.";
    const chunks = chunkDocument(input(text), { maxChars: 60, overlapChars: 5 });

    expect(chunks).toHaveLength(2);
    expect(body(chunks[1]!.content)).toBe("ANNEXURE-I\nScale details for the annexure.");
  });

  it("prefixes every chunk with the provenance header line", () => {
    const text = SENTENCES.join(" ");
    const chunks = chunkDocument(input(text), { maxChars: 100, overlapChars: 40 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.startsWith(`${HEADER_LINE} `)).toBe(true);
    }
  });

  it("renders unknown header fields as ?", () => {
    const chunks = chunkDocument(
      input("Some order text.", { go_number: null, dept: null, issue_date: null, subject: null }),
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content.startsWith("[? | ? | ? | ?] ")).toBe(true);
  });

  it("attributes each chunk to the page its text starts on", () => {
    const text =
      "Alpha paragraph on page one.\fBeta paragraph on page two.\fGamma paragraph on page three.";
    const chunks = chunkDocument(input(text), { maxChars: 40, overlapChars: 5 });

    expect(chunks).toHaveLength(3);
    expect(chunks.map((chunk) => chunk.page)).toEqual([1, 2, 3]);
    // The chunk that starts on page 3 reports page 3.
    expect(chunks[2]!.page).toBe(3);
    expect(body(chunks[2]!.content)).toBe("Gamma paragraph on page three.");
  });

  it("attributes a merged chunk to the page of its first paragraph", () => {
    const chunks = chunkDocument(input("One.\fTwo."));

    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.page).toBe(1);
  });

  it("splits an oversize paragraph at sentence boundaries with a shared overlap", () => {
    const text = SENTENCES.join(" ");
    const chunks = chunkDocument(input(text), { maxChars: 100, overlapChars: 40 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(body(chunk.content).length).toBeLessThanOrEqual(100);
    }
    for (let i = 0; i + 1 < chunks.length; i++) {
      const previous = body(chunks[i]!.content);
      const next = body(chunks[i + 1]!.content);
      // Each piece opens with the tail sentence of the one before it, so a
      // fact straddling the cut appears whole in at least one chunk.
      const overlap = next.slice(0, 35);
      expect(overlap).toMatch(/^Sentence \d/);
      expect(previous.endsWith(overlap)).toBe(true);
    }
    // Nothing was lost across the split.
    for (const sentence of SENTENCES) {
      expect(chunks.some((chunk) => chunk.content.includes(sentence))).toBe(true);
    }
  });

  it("returns [] for empty and whitespace-only text", () => {
    expect(chunkDocument(input(""))).toEqual([]);
    expect(chunkDocument(input("  \n\n \f \t "))).toEqual([]);
  });

  it("numbers chunks with a stable 0-based seq", () => {
    const text = SENTENCES.join(" ");
    const chunks = chunkDocument(input(text), { maxChars: 100, overlapChars: 40 });

    expect(chunks.map((chunk) => chunk.seq)).toEqual(chunks.map((_, i) => i));
  });

  it("rejects nonsensical size options", () => {
    expect(() => chunkDocument(input("text"), { maxChars: 0 })).toThrow(RangeError);
    expect(() => chunkDocument(input("text"), { maxChars: 100, overlapChars: 100 })).toThrow(
      RangeError,
    );
    expect(() => chunkDocument(input("text"), { maxChars: 100, overlapChars: -1 })).toThrow(
      RangeError,
    );
  });
});

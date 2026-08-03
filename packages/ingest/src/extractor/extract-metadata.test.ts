import { describe, expect, it } from "vitest";
import type { LlmClient } from "../pipeline/types.js";
import { extractMetadata } from "./extract-metadata.js";
import { EXTRACTION_PROMPT } from "./prompt.js";

type GenerateRequest = Parameters<LlmClient["generate"]>[0];

function fakeLlm(reply: string): { llm: LlmClient; requests: GenerateRequest[] } {
  const requests: GenerateRequest[] = [];
  const llm: LlmClient = {
    model: "fake-model",
    generate: async (request) => {
      requests.push(request);
      return reply;
    },
  };
  return { llm, requests };
}

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

function reply(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    go_number: "G.O.Ms.No.51",
    go_type: "Ms",
    dept: "Finance",
    issue_date: "2025-04-15",
    subject: "Dearness Allowance",
    subject_te: "కరవు భత్యం",
    supersedes: [],
    confidence: 0.95,
    ...overrides,
  });
}

describe("extractMetadata", () => {
  it("does not flag a confident, complete extraction", async () => {
    const { llm } = fakeLlm(reply());
    const result = await extractMetadata({ pdf: PDF, text: "GOVERNMENT OF ANDHRA PRADESH…", llm });

    expect(result.needsReview).toBe(false);
    expect(result.reviewReasons).toEqual([]);
    expect(result.metadata.go_number).toBe("G.O.Ms.No.51");
  });

  it("always attaches the PDF bytes, even when text extraction succeeded", async () => {
    // Vision reads letterheads and stamps that the text layer drops — the PDF
    // must ride along regardless of how good the text looks.
    const { llm, requests } = fakeLlm(reply());
    await extractMetadata({ pdf: PDF, text: "plenty of extracted text", llm });

    expect(requests).toHaveLength(1);
    expect(requests[0]!.files).toEqual([{ mimeType: "application/pdf", data: PDF }]);
    expect(requests[0]!.json).toBe(true);
  });

  it("includes the extracted text in the prompt when present", async () => {
    const { llm, requests } = fakeLlm(reply());
    await extractMetadata({ pdf: PDF, text: "UNIQUE-MARKER-TEXT", llm });

    expect(requests[0]!.prompt).toContain(EXTRACTION_PROMPT);
    expect(requests[0]!.prompt).toContain("UNIQUE-MARKER-TEXT");
  });

  it("sends the bare prompt for a scanned PDF with no text layer", async () => {
    const { llm, requests } = fakeLlm(reply());
    await extractMetadata({ pdf: PDF, text: "", llm });

    expect(requests[0]!.prompt).toBe(EXTRACTION_PROMPT);
  });

  it("flags low confidence, naming both the value and the threshold", async () => {
    const { llm } = fakeLlm(reply({ confidence: 0.4 }));
    const result = await extractMetadata({ pdf: PDF, text: "", llm });

    expect(result.needsReview).toBe(true);
    expect(result.reviewReasons).toEqual([
      "confidence 0.4 is below the 0.7 review threshold",
    ]);
  });

  it("flags a missing go_number", async () => {
    const { llm } = fakeLlm(reply({ go_number: null }));
    const result = await extractMetadata({ pdf: PDF, text: "", llm });

    expect(result.needsReview).toBe(true);
    expect(result.reviewReasons).toEqual(["go_number could not be extracted"]);
  });

  it("flags a missing issue_date", async () => {
    const { llm } = fakeLlm(reply({ issue_date: null }));
    const result = await extractMetadata({ pdf: PDF, text: "", llm });

    expect(result.needsReview).toBe(true);
    expect(result.reviewReasons).toEqual(["issue_date could not be extracted"]);
  });

  it("flags a missing subject", async () => {
    const { llm } = fakeLlm(reply({ subject: null }));
    const result = await extractMetadata({ pdf: PDF, text: "", llm });

    expect(result.needsReview).toBe(true);
    expect(result.reviewReasons).toEqual(["subject could not be extracted"]);
  });

  it("flags parse problems even when confidence is high", async () => {
    const { llm } = fakeLlm(reply({ go_type: "Gazette" }));
    const result = await extractMetadata({ pdf: PDF, text: "", llm });

    expect(result.needsReview).toBe(true);
    expect(result.reviewReasons).toEqual([
      expect.stringMatching(/^extractor output problem: go_type/),
    ]);
  });

  it("enumerates every cause when several apply at once", async () => {
    const { llm } = fakeLlm("total garbage, no JSON here");
    const result = await extractMetadata({ pdf: PDF, text: "", llm });

    expect(result.needsReview).toBe(true);
    expect(result.reviewReasons).toEqual([
      "confidence 0 is below the 0.7 review threshold",
      "go_number could not be extracted",
      "issue_date could not be extracted",
      "subject could not be extracted",
      expect.stringMatching(/^extractor output problem: no JSON object/),
    ]);
  });

  it("respects a caller-supplied confidence threshold", async () => {
    const { llm } = fakeLlm(reply({ confidence: 0.75 }));

    const lenient = await extractMetadata({ pdf: PDF, text: "", llm });
    expect(lenient.needsReview).toBe(false);

    const strict = await extractMetadata({ pdf: PDF, text: "", llm, confidenceThreshold: 0.9 });
    expect(strict.needsReview).toBe(true);
    expect(strict.reviewReasons).toEqual([
      "confidence 0.75 is below the 0.9 review threshold",
    ]);
  });
});

import { describe, expect, it } from "vitest";
import type { LlmClient } from "../../pipeline/types.js";
import { GeminiVisionOcr, parsePagedTranscript } from "./gemini-vision.js";

type GenerateRequest = Parameters<LlmClient["generate"]>[0];

class FakeLlm implements LlmClient {
  readonly model = "gemini-2.5-flash";
  requests: GenerateRequest[] = [];
  #reply: string;

  constructor(reply: string) {
    this.#reply = reply;
  }

  async generate(request: GenerateRequest): Promise<string> {
    this.requests.push(request);
    return this.#reply;
  }
}

const PDF = new TextEncoder().encode("%PDF-1.4 fake scanned document");

describe("GeminiVisionOcr", () => {
  it("sends the PDF bytes as an inline application/pdf part", async () => {
    const llm = new FakeLlm("===PAGE 1===\nsome text");
    await new GeminiVisionOcr(llm).recognize(PDF);

    expect(llm.requests).toHaveLength(1);
    const files = llm.requests[0]?.files;
    expect(files).toHaveLength(1);
    expect(files?.[0]?.mimeType).toBe("application/pdf");
    // The exact bytes, not a copy or re-encoding — Gemini reads PDFs natively.
    expect(files?.[0]?.data).toBe(PDF);
  });

  it("prompts for verbatim, sentinel-separated, Telugu-preserving transcription", async () => {
    const llm = new FakeLlm("===PAGE 1===\nsome text");
    await new GeminiVisionOcr(llm).recognize(PDF);

    const prompt = llm.requests[0]?.prompt ?? "";
    expect(prompt).toContain("===PAGE n===");
    expect(prompt).toContain("verbatim");
    expect(prompt).toContain("Telugu");
  });

  it("splits the transcript into pages on the sentinels", async () => {
    const llm = new FakeLlm(
      "===PAGE 1===\nG.O.Ms.No.51 Finance Department\n===PAGE 2===\nకరవు భత్యం మంజూరు\n",
    );
    const pages = await new GeminiVisionOcr(llm).recognize(PDF);

    expect(pages).toEqual(["G.O.Ms.No.51 Finance Department", "కరవు భత్యం మంజూరు"]);
  });

  it("names itself for the ocr:<name> provenance tag", () => {
    expect(new GeminiVisionOcr(new FakeLlm("x")).name).toBe("gemini-vision");
  });

  it("throws instead of returning an empty transcription", async () => {
    const llm = new FakeLlm("   \n  ");
    await expect(new GeminiVisionOcr(llm).recognize(PDF)).rejects.toThrow(
      /empty transcription/,
    );
  });
});

describe("parsePagedTranscript", () => {
  it("falls back to one merged page when the model ignored the sentinels", () => {
    expect(parsePagedTranscript("Just a wall of text with no markers.")).toEqual([
      "Just a wall of text with no markers.",
    ]);
  });

  it("keeps non-empty text found before the first sentinel", () => {
    // Could be model chatter or page 1 with a forgotten sentinel — kept either
    // way, because discarding it risks losing corpus text.
    const pages = parsePagedTranscript("Page one, sentinel forgotten\n===PAGE 2===\nPage two");
    expect(pages).toEqual(["Page one, sentinel forgotten", "Page two"]);
  });

  it("tolerates whitespace drift inside sentinel lines", () => {
    const pages = parsePagedTranscript("=== PAGE 1 ===\nfirst\n===PAGE 2===  \nsecond");
    expect(pages).toEqual(["first", "second"]);
  });

  it("preserves blank pages so page numbering stays aligned", () => {
    const pages = parsePagedTranscript("===PAGE 1===\nfirst\n===PAGE 2===\n===PAGE 3===\nthird");
    expect(pages).toEqual(["first", "", "third"]);
  });

  it("does not treat an in-text mention of the sentinel as a page break", () => {
    // The pattern is anchored to whole lines; prose that quotes it must not
    // split the page.
    const pages = parsePagedTranscript("===PAGE 1===\nthe marker ===PAGE 2=== appears in prose");
    expect(pages).toEqual(["the marker ===PAGE 2=== appears in prose"]);
  });
});

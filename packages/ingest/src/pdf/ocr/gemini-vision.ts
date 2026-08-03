import type { LlmClient, OcrProvider } from "../../pipeline/types.js";

/**
 * OCR fallback via Gemini's native PDF reading: the bytes go up as an inline
 * `application/pdf` part — no rasterisation step — with a prompt demanding
 * verbatim, page-separated transcription. Scanned GOs are predominantly
 * Telugu, so the prompt forbids translation and summarising explicitly; a
 * "helpfully" translated transcript would poison retrieval for Telugu queries.
 */

const TRANSCRIPTION_PROMPT = [
  "Transcribe this PDF document verbatim, page by page.",
  "Before each page's text, output exactly one line of the form ===PAGE n=== " +
    "where n is the 1-based page number.",
  "Transcribe ALL text exactly as printed, including Telugu text, English text, " +
    "numbers, dates, table contents, stamps and signatures.",
  "Do not translate, summarise, correct or omit anything. For a blank page, " +
    "output its sentinel line and nothing else.",
  "Output only the sentinel lines and the transcription — no commentary.",
].join("\n");

/**
 * A sentinel line, tolerantly: models drift on spacing, and rejecting
 * "=== PAGE 2 ===" would silently glue two pages together.
 */
const PAGE_SENTINEL = /^[ \t]*===\s*PAGE\s+\d+\s*===[ \t]*$/im;

export function parsePagedTranscript(transcript: string): string[] {
  const parts = transcript.split(PAGE_SENTINEL).map((part) => part.trim());
  // No sentinel at all — the model ignored the format instruction. One merged
  // page is still usable text; page numbers in citations degrade, the corpus
  // does not.
  if (parts.length === 1) return parts;

  // Before the first sentinel sits either nothing, model chatter, or page 1
  // with a forgotten sentinel. Only the empty case is safe to drop: discarding
  // text risks losing corpus content, while an extra junk page is caught by
  // the human in the review queue.
  const preamble = parts[0] ?? "";
  const pages = parts.slice(1);
  return preamble === "" ? pages : [preamble, ...pages];
}

export class GeminiVisionOcr implements OcrProvider {
  readonly name = "gemini-vision";
  #llm: LlmClient;

  constructor(llm: LlmClient) {
    this.#llm = llm;
  }

  async recognize(pdf: Uint8Array): Promise<string[]> {
    const transcript = await this.#llm.generate({
      prompt: TRANSCRIPTION_PROMPT,
      files: [{ mimeType: "application/pdf", data: pdf }],
    });
    // An empty transcript is a failure, not a result — returning it would let
    // a scanned GO enter the pipeline as a blank document with OCR provenance.
    if (transcript.trim() === "") {
      throw new Error(`${this.#llm.model} returned an empty transcription`);
    }
    return parsePagedTranscript(transcript);
  }
}

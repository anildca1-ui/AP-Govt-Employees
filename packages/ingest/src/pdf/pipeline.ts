import type { ExtractedPdf, OcrProvider } from "../pipeline/types.js";
import { extractPdfText } from "./extract.js";

/**
 * Stage-1 orchestration (PLAN.md Part 2): text-extract → (if scanned) OCR.
 * The OCR provider is injected so the caller decides the fallback order —
 * Surya once its worker deploys, Gemini vision meanwhile, or none at all.
 */

export interface ProcessPdfOptions {
  /** OCR fallback for scanned PDFs. Omit to pass scanned docs through as-is. */
  ocr?: OcrProvider;
}

export interface ProcessedPdf {
  extracted: ExtractedPdf;
  /** Where the text came from, for provenance and the review queue. */
  textSource: "text-layer" | `ocr:${string}`;
}

export async function processPdf(
  bytes: Uint8Array,
  opts: ProcessPdfOptions = {},
): Promise<ProcessedPdf> {
  const extracted = await extractPdfText(bytes);
  if (!extracted.isScanned) return { extracted, textSource: "text-layer" };

  const { ocr } = opts;
  if (ocr === undefined) {
    // No OCR wired up: return the (near-empty) text layer unchanged so the
    // caller can flag the document for review instead of silently dropping it.
    return { extracted, textSource: "text-layer" };
  }

  const pages = (await ocr.recognize(bytes)).map((page) => page.trim());
  return {
    extracted: {
      text: pages.join("\f"),
      // The OCR page count wins over the PDF's: perPageChars and the \f splits
      // in `text` must describe the same pages, or the chunker's page numbers
      // (stage 3) point at the wrong places.
      totalPages: pages.length,
      perPageChars: pages.map((page) => page.length),
      // Still true: the PDF itself is scanned, only the text came from OCR.
      // textSource carries the "which OCR" half of the provenance.
      isScanned: true,
    },
    textSource: `ocr:${ocr.name}`,
  };
}

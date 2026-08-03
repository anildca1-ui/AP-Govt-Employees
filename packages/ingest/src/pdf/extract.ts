import { extractText, getDocumentProxy } from "unpdf";
import type { ExtractedPdf } from "../pipeline/types.js";

/**
 * Stage 1 of the pipeline (PLAN.md Part 2): PDF bytes → text via the embedded
 * text layer. Post-2008 GOs from goir are usually born-digital and extract
 * cleanly; older or forwarded GOs are often flatbed scans with no text layer at
 * all, and those must be routed to OCR instead of entering the corpus as blank
 * documents — hence the per-page character counts and scanned detection here.
 */

/**
 * A page under this many characters has no real text layer. Genuine GO pages
 * run to hundreds or thousands of characters; what a scan yields is at most a
 * page number, a stamp, or stray OCR noise baked into the file.
 */
export const SCANNED_NEAR_EMPTY_PAGE_CHARS = 50;

/**
 * Scanned when at least this fraction of pages is near-empty. Deliberately not
 * 1.0: govt scans frequently carry one searchable cover or endorsement page
 * (added later, or OCR'd by whoever forwarded it), and a single such page must
 * not disguise an otherwise image-only document.
 */
export const SCANNED_NEAR_EMPTY_PAGE_RATIO = 0.6;

/**
 * Scanned when the mean falls below this many characters per page, even if few
 * pages are individually "near-empty". Catches scans where every page carries
 * modest noise chars — enough to clear the per-page bar, nowhere near a real
 * text layer.
 */
export const SCANNED_MEAN_CHARS_PER_PAGE = 100;

/** True when the text layer is too thin to trust and the PDF needs OCR. */
export function detectScanned(perPageChars: number[]): boolean {
  // A zero-page document has no usable text layer either; sending the
  // degenerate file down the OCR/review path is the conservative call.
  if (perPageChars.length === 0) return true;

  const nearEmpty = perPageChars.filter(
    (chars) => chars < SCANNED_NEAR_EMPTY_PAGE_CHARS,
  ).length;
  if (nearEmpty / perPageChars.length >= SCANNED_NEAR_EMPTY_PAGE_RATIO) return true;

  const total = perPageChars.reduce((sum, chars) => sum + chars, 0);
  return total / perPageChars.length < SCANNED_MEAN_CHARS_PER_PAGE;
}

export async function extractPdfText(bytes: Uint8Array): Promise<ExtractedPdf> {
  // pdf.js takes ownership of the buffer it is handed (it transfers it to its
  // worker), and the caller still needs the original bytes afterwards — for
  // the sha256, storage, and the OCR fallback — so it gets a private copy.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  try {
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    // Scans often extract to whitespace-only residue; trimming keeps the char
    // counts honest for detectScanned.
    const pages = text.map((page) => page.trim());
    const perPageChars = pages.map((page) => page.length);
    return {
      text: pages.join("\f"),
      totalPages,
      perPageChars,
      isScanned: detectScanned(perPageChars),
    };
  } finally {
    // extractText only destroys proxies it opens itself; this one is ours to
    // close, or every processed PDF stays resident until the run ends.
    await pdf.loadingTask.destroy();
  }
}

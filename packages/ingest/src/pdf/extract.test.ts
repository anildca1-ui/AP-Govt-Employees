import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { detectScanned, extractPdfText } from "./extract.js";

/**
 * Fixtures are generated with pdf-lib rather than checked in: what matters is
 * "pages with a real text layer" vs "image-only pages", and building them at
 * test time keeps the intent visible next to the assertions.
 */

/** 1x1 transparent PNG — the smallest possible stand-in for a scanned page. */
const PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/**
 * ~150 chars, so a page comfortably clears both scanned thresholds. Short
 * lines on purpose: pdf.js drops text drawn beyond the page edge, so one long
 * line would extract truncated and skew the char counts.
 */
function pageText(label: string): string {
  return [
    `${label}: Government of Andhra Pradesh hereby sanctions`,
    "Dearness Allowance to the employees of the State",
    "Government with effect from the date noted below.",
  ].join("\n");
}

/** One entry per page: a string draws text, null leaves an image-only page. */
async function makePdf(pages: (string | null)[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const png = await doc.embedPng(PIXEL_PNG);
  for (const text of pages) {
    const page = doc.addPage();
    if (text === null) {
      page.drawImage(png, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
    } else {
      page.drawText(text, { x: 40, y: 700, size: 10, font, lineHeight: 14 });
    }
  }
  return doc.save();
}

describe("extractPdfText", () => {
  it("extracts every page and joins them with form-feeds", async () => {
    const bytes = await makePdf([pageText("Page one"), pageText("Page two"), pageText("Page three")]);
    const extracted = await extractPdfText(bytes);

    expect(extracted.totalPages).toBe(3);
    const pages = extracted.text.split("\f");
    expect(pages).toHaveLength(3);
    expect(pages[0]).toContain("Page one");
    expect(pages[1]).toContain("Page two");
    expect(pages[2]).toContain("Page three");
    // perPageChars must describe exactly the pages the \f splits produce —
    // stage 3 maps chunk offsets to page numbers through this invariant.
    expect(extracted.perPageChars).toEqual(pages.map((page) => page.length));
    expect(extracted.isScanned).toBe(false);
  });

  it("flags an image-only PDF as scanned", async () => {
    const bytes = await makePdf([null, null, null]);
    const extracted = await extractPdfText(bytes);

    expect(extracted.totalPages).toBe(3);
    expect(extracted.perPageChars).toEqual([0, 0, 0]);
    expect(extracted.isScanned).toBe(true);
  });

  it("keeps a mostly-text document with one image page out of the scanned bucket", async () => {
    // The realistic shape of a born-digital GO with a scanned annexure or seal
    // page — one blank-ish page must not send the whole doc to OCR.
    const bytes = await makePdf([pageText("Order"), pageText("Annexure"), pageText("Schedule"), null]);
    const extracted = await extractPdfText(bytes);

    expect(extracted.isScanned).toBe(false);
    expect(extracted.perPageChars).toHaveLength(4);
    expect(extracted.perPageChars[3]).toBe(0);
  });

  it("does not consume the caller's bytes", async () => {
    // pdf.js transfers the buffer it is handed; extractPdfText must copy so
    // the same bytes can still be hashed, stored, and sent to OCR afterwards.
    const bytes = await makePdf([pageText("Page one")]);
    await extractPdfText(bytes);

    expect(bytes.byteLength).toBeGreaterThan(0);
    await expect(extractPdfText(bytes)).resolves.toMatchObject({ totalPages: 1 });
  });
});

describe("detectScanned", () => {
  it("treats a zero-page document as scanned", () => {
    expect(detectScanned([])).toBe(true);
  });

  it("flags a single empty page", () => {
    expect(detectScanned([0])).toBe(true);
  });

  it("passes a single healthy page", () => {
    expect(detectScanned([400])).toBe(false);
  });

  it("flags a single thin page via the mean threshold", () => {
    // 80 chars clears the near-empty bar but is nowhere near a real text layer.
    expect(detectScanned([80])).toBe(true);
  });

  it("flags a scan whose cover page was OCR'd", () => {
    // Ratio rule: 3 of 5 pages near-empty (60%) — two searchable pages of
    // noise/stamps must not disguise an image-only document.
    expect(detectScanned([0, 10, 20, 500, 600])).toBe(true);
  });

  it("passes a text document with one blank page", () => {
    expect(detectScanned([500, 600, 20])).toBe(false);
  });

  it("flags uniform per-page noise via the mean threshold", () => {
    // Every page clears the near-empty bar individually, yet 70 chars/page
    // average is noise, not a text layer.
    expect(detectScanned([60, 70, 80])).toBe(true);
  });
});

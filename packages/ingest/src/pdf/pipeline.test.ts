import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import type { OcrProvider } from "../pipeline/types.js";
import { processPdf } from "./pipeline.js";

/** 1x1 transparent PNG — the smallest possible stand-in for a scanned page. */
const PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

async function makeScannedPdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const png = await doc.embedPng(PIXEL_PNG);
  for (let i = 0; i < pageCount; i += 1) {
    const page = doc.addPage();
    page.drawImage(png, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
  }
  return doc.save();
}

async function makeTextPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage();
  // Short lines: pdf.js drops text drawn beyond the page edge, and this page
  // must stay clearly above the scanned thresholds.
  page.drawText(
    [
      "Government of Andhra Pradesh hereby sanctions",
      "Dearness Allowance to the employees of the State",
      "Government with effect from the date noted below.",
    ].join("\n"),
    { x: 40, y: 700, size: 10, font, lineHeight: 14 },
  );
  return doc.save();
}

class FakeOcr implements OcrProvider {
  readonly name = "fake";
  calls: Uint8Array[] = [];
  #pages: string[];

  constructor(pages: string[]) {
    this.#pages = pages;
  }

  async recognize(pdf: Uint8Array): Promise<string[]> {
    this.calls.push(pdf);
    return this.#pages;
  }
}

describe("processPdf", () => {
  it("uses the text layer and never invokes OCR for a born-digital PDF", async () => {
    const ocr = new FakeOcr(["should never be used"]);
    const { extracted, textSource } = await processPdf(await makeTextPdf(), { ocr });

    expect(textSource).toBe("text-layer");
    expect(extracted.isScanned).toBe(false);
    expect(extracted.text).toContain("Dearness Allowance");
    expect(ocr.calls).toEqual([]);
  });

  it("rebuilds a scanned document from OCR pages", async () => {
    const pages = ["కరవు భత్యం మంజూరు చేయడమైనది", "Signed by the Principal Secretary"];
    const ocr = new FakeOcr(pages);
    const bytes = await makeScannedPdf(2);
    const { extracted, textSource } = await processPdf(bytes, { ocr });

    expect(textSource).toBe("ocr:fake");
    expect(extracted.text).toBe(pages.join("\f"));
    expect(extracted.totalPages).toBe(2);
    expect(extracted.perPageChars).toEqual(pages.map((page) => page.length));
    // Provenance survives: the PDF is still a scan, whatever produced the text.
    expect(extracted.isScanned).toBe(true);
  });

  it("hands the OCR provider the original, unconsumed bytes", async () => {
    const ocr = new FakeOcr(["page"]);
    const bytes = await makeScannedPdf(1);
    await processPdf(bytes, { ocr });

    // Same reference, and still holding the PDF — extraction must not have
    // detached the buffer before OCR gets to read it.
    expect(ocr.calls).toHaveLength(1);
    expect(ocr.calls[0]).toBe(bytes);
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  it("trims OCR pages so perPageChars stays honest", async () => {
    const ocr = new FakeOcr(["  padded page  ", "x"]);
    const { extracted } = await processPdf(await makeScannedPdf(2), { ocr });

    expect(extracted.text).toBe("padded page\fx");
    expect(extracted.perPageChars).toEqual([11, 1]);
  });

  it("passes a scanned PDF through unchanged when no OCR is wired", async () => {
    const { extracted, textSource } = await processPdf(await makeScannedPdf(2));

    // The caller sees isScanned with a near-empty text layer and flags the
    // document for review — it must not be dropped silently.
    expect(textSource).toBe("text-layer");
    expect(extracted.isScanned).toBe(true);
    expect(extracted.perPageChars).toEqual([0, 0]);
  });
});

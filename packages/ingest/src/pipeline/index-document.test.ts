import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { indexDocument, type DocumentToIndex } from "./index-document.js";
import type { EmbeddingProvider, OcrProvider } from "./types.js";

/**
 * The join these cover was missing entirely: extract, chunk, embed and write
 * each existed and were each tested, and nothing called them in sequence. An
 * approved GO reached the library and never became searchable, and nothing
 * failed — the chat simply answered "not found in corpus" forever.
 *
 * So these assert on the seam rather than on the stages: that a real PDF comes
 * out the far end as chunks with vectors attached, and that the cases which
 * would otherwise write nonsense are refused instead.
 */

const A_REAL_GO = [
  "GOVERNMENT OF ANDHRA PRADESH",
  "FINANCE (HR.IV) DEPARTMENT",
  "",
  "Dearness Allowance to State Government Employees -",
  "Enhanced Rate - Orders - Issued.",
  "",
  "G.O.Ms.No.60",
  "Dated: 12-03-2025",
  "",
  "O R D E R :",
  "",
  "1. Government hereby order enhancement of the Dearness Allowance",
  "to State Government Employees from 33.67% to 37.31% of the basic pay",
  "with effect from 1st January 2025.",
  "",
  "2. The arrears on account of this enhancement shall be credited to",
  "the General Provident Fund account of the employee.",
].join("\n");

async function makePdf(pages: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = doc.addPage();
    page.drawText(text, { x: 40, y: 720, size: 9, font, lineHeight: 12 });
  }
  return doc.save();
}

/** Records what it was asked to embed, and returns correctly shaped vectors. */
function fakeEmbeddings(): EmbeddingProvider & { seen: string[][] } {
  const seen: string[][] = [];
  return {
    name: "fake",
    dimensions: 1024,
    seen,
    async embed(texts: string[]) {
      seen.push(texts);
      return texts.map(() => Array.from({ length: 1024 }, () => 0.001));
    },
  };
}

interface WriteState {
  deleted: string[];
  inserted: Record<string, unknown>[];
}

/** Enough PostgREST surface for writeChunks. */
function fakeDb(state: WriteState) {
  return {
    from(table: string) {
      if (table !== "chunks") throw new Error(`unexpected table ${table}`);
      return {
        delete: () => ({
          eq: (_column: string, value: string) => {
            state.deleted.push(value);
            return Promise.resolve({ error: null });
          },
        }),
        insert: (rows: Record<string, unknown>[]) => {
          state.inserted.push(...rows);
          return Promise.resolve({ error: null });
        },
      };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const document: DocumentToIndex = {
  id: "11111111-1111-4111-8111-111111111111",
  go_number: "G.O.Ms.No.60",
  dept: "Finance",
  issue_date: "2025-03-12",
  subject: "Dearness Allowance - Enhanced Rate",
};

describe("indexDocument", () => {
  it("turns an approved GO into chunks with vectors — the step that was missing", async () => {
    const state: WriteState = { deleted: [], inserted: [] };
    const embeddings = fakeEmbeddings();

    const result = await indexDocument({
      db: fakeDb(state),
      document,
      pdf: await makePdf([A_REAL_GO]),
      embeddings,
    });

    expect(result.status).toBe("indexed");
    expect(result.chunks).toBeGreaterThan(0);
    expect(state.inserted).toHaveLength(result.chunks);

    // Every written row must carry a vector; a chunk without one is invisible
    // to retrieval while looking present in the table.
    for (const row of state.inserted) {
      expect(row.document_id).toBe(document.id);
      expect(Array.isArray(row.embedding) || typeof row.embedding === "string").toBe(true);
    }
  });

  it("attaches the GO's provenance to what gets embedded", async () => {
    // Retrieval hits have to carry the GO number and date with them, or an
    // answer cannot cite its source (CLAUDE.md rule 1).
    const embeddings = fakeEmbeddings();

    await indexDocument({
      db: fakeDb({ deleted: [], inserted: [] }),
      document,
      pdf: await makePdf([A_REAL_GO]),
      embeddings,
    });

    expect(embeddings.seen[0]?.[0]).toContain("G.O.Ms.No.60");
  });

  it("embeds in one call per document, not one per chunk", async () => {
    // Providers bill and rate-limit per request; a chunk-at-a-time loop turns
    // one GO into dozens of billed calls.
    const embeddings = fakeEmbeddings();

    await indexDocument({
      db: fakeDb({ deleted: [], inserted: [] }),
      document,
      pdf: await makePdf([A_REAL_GO, A_REAL_GO, A_REAL_GO]),
      embeddings,
    });

    expect(embeddings.seen).toHaveLength(1);
  });

  it("leaves a scan alone rather than indexing whitespace", async () => {
    // A scanned GO extracts to almost nothing. Indexing that residue would put
    // a document in the corpus that retrieves for nothing and can be cited for
    // nothing, which is worse than it being absent.
    const state: WriteState = { deleted: [], inserted: [] };

    const result = await indexDocument({
      db: fakeDb(state),
      document,
      pdf: await makePdf([" "]),
      embeddings: fakeEmbeddings(),
    });

    expect(result.status).toBe("needs-ocr");
    expect(state.inserted).toHaveLength(0);
  });

  it("uses OCR for a scan when one is configured", async () => {
    const ocr: OcrProvider = {
      name: "fake-ocr",
      recognize: async () => [A_REAL_GO],
    };
    const state: WriteState = { deleted: [], inserted: [] };

    const result = await indexDocument({
      db: fakeDb(state),
      document,
      pdf: await makePdf([" "]),
      embeddings: fakeEmbeddings(),
      ocr,
    });

    expect(result.status).toBe("indexed");
    expect(state.inserted.length).toBeGreaterThan(0);
  });

  it("replaces a document's chunks on re-index rather than duplicating them", async () => {
    const state: WriteState = { deleted: [], inserted: [] };
    const pdf = await makePdf([A_REAL_GO]);

    await indexDocument({ db: fakeDb(state), document, pdf, embeddings: fakeEmbeddings() });
    const afterFirst = state.inserted.length;
    state.inserted.length = 0;

    await indexDocument({ db: fakeDb(state), document, pdf, embeddings: fakeEmbeddings() });

    expect(state.deleted).toContain(document.id);
    expect(state.inserted).toHaveLength(afterFirst);
  });
});

import { describe, expect, it } from "vitest";
import { citationsFor, rerankChunks } from "./rerank.js";
import { retrieve, type RetrievalDb } from "./retrieve.js";
import type { RetrievedChunk } from "./types.js";

function chunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    chunkId: "c1",
    documentId: "d1",
    seq: 1,
    content: "text",
    page: 1,
    goNumber: "G.O.Ms.No.51",
    goType: "Ms",
    dept: "Finance",
    issueDate: "2025-04-15",
    subject: "Dearness Allowance",
    subjectTe: "కరువు భత్యం",
    pdfUrl: "https://goir.ap.gov.in/51.pdf",
    supersededBy: null,
    vectorScore: 0.9,
    keywordScore: 0.5,
    score: 0.74,
    ...overrides,
  };
}

/** Records RPC calls and replays canned rows. */
function fakeDb(responses: Record<string, unknown[]>, calls: { name: string; params: Record<string, unknown> }[] = []) {
  const db: RetrievalDb = {
    rpc(name, params) {
      calls.push({ name, params });
      return Promise.resolve({ data: responses[name] ?? [], error: null });
    },
  };
  return { db, calls };
}

const GO_ROW = {
  chunk_id: "c1",
  document_id: "d1",
  seq: 1,
  content: "Dearness Allowance sanctioned",
  page: 1,
  go_number: "G.O.Ms.No.51",
  go_type: "Ms",
  dept: "Finance",
  issue_date: "2025-04-15",
  subject: "DA",
  subject_te: "కరువు భత్యం",
  pdf_url: "https://goir.ap.gov.in/51.pdf",
  superseded_by: null,
};

describe("retrieve — GO-number short-circuit", () => {
  it("goes straight to the named GO instead of searching", async () => {
    const { db, calls } = fakeDb({ chunks_for_go_number: [GO_ROW] });

    const result = await retrieve(db, { query: "G.O.Ms.No.51 లో ఏమి ఉంది?" });

    expect(result.mode).toBe("go-number");
    expect(calls.map((c) => c.name)).toEqual(["chunks_for_go_number"]);
    expect(calls[0]?.params.go_number_query).toBe("G.O.Ms.No.51");
  });

  it("canonicalises the number before looking it up", async () => {
    const { db, calls } = fakeDb({ chunks_for_go_number: [GO_ROW] });

    await retrieve(db, { query: "what does GO Ms No 051 say" });

    expect(calls[0]?.params.go_number_query).toBe("G.O.Ms.No.51");
  });

  it("keeps the GO's own chunk order rather than reranking them", async () => {
    // Reranking here would shuffle one order's paragraphs out of sequence.
    const rows = [1, 2, 3, 4, 5, 6, 7].map((seq) => ({
      ...GO_ROW,
      chunk_id: `c${seq}`,
      seq,
    }));
    const { db } = fakeDb({ chunks_for_go_number: rows });

    const result = await retrieve(db, { query: "G.O.Ms.No.51" });

    expect(result.chunks.map((c) => c.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("falls through to hybrid search when the named GO is not in the corpus", async () => {
    // Answering "not found" would be wrong when a later GO discusses it.
    const { db, calls } = fakeDb({ chunks_for_go_number: [], search_chunks: [GO_ROW] });

    const result = await retrieve(db, { query: "G.O.Ms.No.999 details" });

    expect(calls.map((c) => c.name)).toEqual(["chunks_for_go_number", "search_chunks"]);
    expect(result.mode).toBe("hybrid");
  });

  it("uses hybrid search for a plain question", async () => {
    const { db, calls } = fakeDb({ search_chunks: [GO_ROW] });

    const result = await retrieve(db, { query: "DA ఎంత శాతం పెరిగింది?" });

    expect(result.mode).toBe("hybrid");
    expect(calls.map((c) => c.name)).toEqual(["search_chunks"]);
  });

  it("passes the embedding and query text through to the search function", async () => {
    const { db, calls } = fakeDb({ search_chunks: [] });
    const embedding = Array.from({ length: 1024 }, () => 0.1);

    await retrieve(db, { query: "gratuity rules", embedding, matchCount: 20 });

    expect(calls[0]?.params).toMatchObject({
      query_text: "gratuity rules",
      query_embedding: embedding,
      match_count: 20,
    });
  });

  it("surfaces a database error instead of answering from nothing", async () => {
    const db: RetrievalDb = {
      rpc: () => Promise.resolve({ data: null, error: { message: "connection reset" } }),
    };

    await expect(retrieve(db, { query: "pension" })).rejects.toThrow(/connection reset/);
  });
});

describe("retrieve — supersession", () => {
  it("reports superseded documents so the answer can follow the chain", async () => {
    // Rule 3: the answer must use the superseding GO and say that it did.
    const { db } = fakeDb({
      search_chunks: [
        { ...GO_ROW, document_id: "old", superseded_by: "new" },
        { ...GO_ROW, chunk_id: "c2", document_id: "new", superseded_by: null },
      ],
    });

    const result = await retrieve(db, { query: "dearness allowance" });

    expect(result.supersessions).toEqual([{ supersededId: "old", supersededBy: "new" }]);
  });

  it("reports each superseded document once, not once per chunk", async () => {
    const { db } = fakeDb({
      search_chunks: [
        { ...GO_ROW, chunk_id: "a", document_id: "old", seq: 1, superseded_by: "new" },
        { ...GO_ROW, chunk_id: "b", document_id: "old", seq: 2, superseded_by: "new" },
      ],
    });

    const result = await retrieve(db, { query: "dearness allowance" });

    expect(result.supersessions).toHaveLength(1);
  });
});

describe("rerankChunks", () => {
  it("spreads results across documents rather than returning one GO five times", () => {
    // Five consecutive chunks of one long order can only ever cite one GO.
    const chunks = [
      chunk({ chunkId: "a1", documentId: "A", score: 0.99 }),
      chunk({ chunkId: "a2", documentId: "A", score: 0.98 }),
      chunk({ chunkId: "a3", documentId: "A", score: 0.97 }),
      chunk({ chunkId: "a4", documentId: "A", score: 0.96 }),
      chunk({ chunkId: "b1", documentId: "B", score: 0.5 }),
      chunk({ chunkId: "c1", documentId: "C", score: 0.4 }),
      chunk({ chunkId: "d1", documentId: "D", score: 0.3 }),
    ];

    const top = rerankChunks(chunks, { limit: 5, maxPerDocument: 2 });

    expect(top.map((c) => c.documentId)).toEqual(["A", "A", "B", "C", "D"]);
  });

  it("still fills the quota from one document when the corpus offers nothing else", () => {
    const chunks = [1, 2, 3, 4, 5, 6].map((n) =>
      chunk({ chunkId: `a${n}`, documentId: "A", score: 1 - n / 10 }),
    );

    const top = rerankChunks(chunks, { limit: 5, maxPerDocument: 2 });

    expect(top).toHaveLength(5);
    expect(top.map((c) => c.chunkId)).toEqual(["a1", "a2", "a3", "a4", "a5"]);
  });

  it("orders by score before applying the per-document cap", () => {
    const chunks = [
      chunk({ chunkId: "low", documentId: "A", score: 0.1 }),
      chunk({ chunkId: "high", documentId: "A", score: 0.9 }),
      chunk({ chunkId: "mid", documentId: "A", score: 0.5 }),
    ];

    expect(rerankChunks(chunks, { limit: 2, maxPerDocument: 2 }).map((c) => c.chunkId)).toEqual([
      "high",
      "mid",
    ]);
  });

  it("handles empty input and a zero limit", () => {
    expect(rerankChunks([])).toEqual([]);
    expect(rerankChunks([chunk()], { limit: 0 })).toEqual([]);
  });
});

describe("citationsFor", () => {
  it("emits one citation per document, in first-appearance order", () => {
    const citations = citationsFor([
      chunk({ documentId: "A", goNumber: "G.O.Ms.No.1" }),
      chunk({ documentId: "A", goNumber: "G.O.Ms.No.1" }),
      chunk({ documentId: "B", goNumber: "G.O.Ms.No.2" }),
    ]);

    expect(citations.map((c) => c.goNumber)).toEqual(["G.O.Ms.No.1", "G.O.Ms.No.2"]);
  });

  it("carries the GO number, date and link every answer must cite (rule 1)", () => {
    const [citation] = citationsFor([chunk()]);

    expect(citation).toMatchObject({
      goNumber: "G.O.Ms.No.51",
      issueDate: "2025-04-15",
      pdfUrl: "https://goir.ap.gov.in/51.pdf",
    });
  });

  it("carries supersession through to the citation", () => {
    const [citation] = citationsFor([chunk({ supersededBy: "newer-doc" })]);
    expect(citation?.supersededBy).toBe("newer-doc");
  });
});

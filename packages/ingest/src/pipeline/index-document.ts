import type { SupabaseClient } from "@supabase/supabase-js";
import { chunkDocument } from "../chunk/chunker.js";
import { extractPdfText } from "../pdf/extract.js";
import { writeChunks } from "../write/chunks-writer.js";
import type { EmbeddingProvider, OcrProvider } from "./types.js";

/**
 * Turns an approved document into searchable chunks.
 *
 * This is the join between four stages that were each built and tested on their
 * own and never actually connected: extract → chunk → embed → write. Without
 * it, approving a Government Order inserts a row in `documents` and nothing
 * else — the GO appears in the library, and the chat can never find it, because
 * no chunk of it exists to retrieve. The failure is silent and total: the chat
 * answers "not found in corpus" forever, no matter how many GOs are approved.
 *
 * Approval and indexing are deliberately separate steps. Indexing costs money
 * (embeddings are billed per token) and takes seconds per document, so it must
 * not sit inside a form submission an administrator is waiting on. Approve
 * quickly, index in bulk.
 */

export interface DocumentToIndex {
  id: string;
  go_number: string | null;
  dept: string | null;
  issue_date: string | null;
  subject: string | null;
}

export interface IndexResult {
  documentId: string;
  status: "indexed" | "needs-ocr" | "empty";
  chunks: number;
  /** Set when the PDF had no usable text layer. */
  reason?: string;
}

export interface IndexOptions {
  db: SupabaseClient;
  document: DocumentToIndex;
  pdf: Uint8Array;
  embeddings: EmbeddingProvider;
  /** Used when the PDF turns out to be a scan. Omit to skip those documents. */
  ocr?: OcrProvider;
  log?: (message: string) => void;
}

export async function indexDocument({
  db,
  document,
  pdf,
  embeddings,
  ocr,
  log = () => {},
}: IndexOptions): Promise<IndexResult> {
  const extracted = await extractPdfText(pdf);

  let text = extracted.text;

  if (extracted.isScanned) {
    if (ocr === undefined) {
      // Not an error: a scanned GO is normal, and it is better left for OCR
      // than indexed from whitespace residue that would retrieve for nothing.
      return {
        documentId: document.id,
        status: "needs-ocr",
        chunks: 0,
        reason: "no text layer and no OCR provider configured",
      };
    }
    log(`  ${document.go_number ?? document.id}: scanned, running OCR`);
    // Pages are rejoined with \f because that is the separator the chunker
    // splits on to know which page a chunk starts from.
    text = (await ocr.recognize(pdf)).join("\f");
  }

  const chunks = chunkDocument({
    text,
    header: {
      go_number: document.go_number,
      dept: document.dept,
      issue_date: document.issue_date,
      subject: document.subject,
    },
  });

  if (chunks.length === 0) {
    return {
      documentId: document.id,
      status: "empty",
      chunks: 0,
      reason: "no text to index after extraction",
    };
  }

  // One call per document rather than per chunk: providers bill and rate-limit
  // per request, and the batch sizes live inside each provider.
  const vectors = await embeddings.embed(chunks.map((chunk) => chunk.content));

  // writeChunks replaces the document's chunks atomically enough for our
  // purposes — it validates the whole batch before deleting anything — so
  // re-indexing a document is safe and idempotent.
  const { written } = await writeChunks(db, document.id, chunks, vectors);

  return { documentId: document.id, status: "indexed", chunks: written };
}

/**
 * Approved documents that have no chunks yet.
 *
 * The absence of chunks is the queue: it needs no extra state column, it is
 * self-healing after a crash, and re-running the indexer is always safe.
 */
export async function findUnindexedDocuments(
  db: SupabaseClient,
  limit = 500,
): Promise<DocumentToIndex[]> {
  const { data: approved, error } = await db
    .from("documents")
    .select("id, go_number, dept, issue_date, subject")
    .eq("status", "approved")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error !== null) throw new Error(`documents read failed: ${error.message}`);
  if (approved === null || approved.length === 0) return [];

  const { data: chunked, error: chunkError } = await db
    .from("chunks")
    .select("document_id")
    .in(
      "document_id",
      approved.map((row) => row.id),
    );
  if (chunkError !== null) throw new Error(`chunks read failed: ${chunkError.message}`);

  const indexed = new Set((chunked ?? []).map((row) => row.document_id));
  return (approved as DocumentToIndex[]).filter((row) => !indexed.has(row.id));
}

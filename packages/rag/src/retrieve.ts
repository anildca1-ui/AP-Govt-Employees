import { findGoReference } from "./go-number.js";
import { rerankChunks, type RerankOptions } from "./rerank.js";
import type { RetrievalResult, RetrievedChunk } from "./types.js";

/**
 * Retrieval over the approved corpus.
 *
 * Two paths, in the order PLAN.md Part 2 specifies:
 *   1. the query names a GO — return that order's own chunks, in document
 *      order, because someone asking about G.O.Ms.No.51 wants that GO and not
 *      the twelve documents nearest it in embedding space;
 *   2. otherwise hybrid search, 0.6 vector + 0.4 keyword, top-12 reranked to 5.
 *
 * The SQL lives in migration 004 so both halves use their indexes; this module
 * decides which path to take and what the answer layer is handed.
 */

/** The two RPCs migration 004 defines. */
export interface RetrievalDb {
  rpc(
    name: string,
    params: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export interface RetrieveOptions {
  query: string;
  /** Query embedding, 1024-d. Omitted for a keyword-only search. */
  embedding?: number[] | null;
  /** How many candidates to pull before reranking. */
  matchCount?: number;
  rerank?: RerankOptions;
}

/** Raw row shape returned by both RPCs (snake_case, straight from Postgres). */
interface SearchRow {
  chunk_id: string;
  document_id: string;
  seq: number;
  content: string;
  page: number | null;
  go_number: string | null;
  go_type: string | null;
  dept: string | null;
  issue_date: string | null;
  subject: string | null;
  subject_te: string | null;
  pdf_url: string | null;
  superseded_by: string | null;
  vector_score?: number;
  keyword_score?: number;
  score?: number;
}

function toChunk(row: SearchRow): RetrievedChunk {
  return {
    chunkId: row.chunk_id,
    documentId: row.document_id,
    seq: row.seq,
    content: row.content,
    page: row.page,
    goNumber: row.go_number,
    goType: row.go_type,
    dept: row.dept,
    issueDate: row.issue_date,
    subject: row.subject,
    subjectTe: row.subject_te,
    pdfUrl: row.pdf_url,
    supersededBy: row.superseded_by,
    vectorScore: row.vector_score ?? 0,
    keywordScore: row.keyword_score ?? 0,
    // The exact-GO path has no relevance score; 1 keeps ordering stable without
    // pretending the two paths produce comparable numbers.
    score: row.score ?? 1,
  };
}

function supersessionsIn(chunks: RetrievedChunk[]): RetrievalResult["supersessions"] {
  const seen = new Map<string, string>();
  for (const chunk of chunks) {
    if (chunk.supersededBy !== null && !seen.has(chunk.documentId)) {
      seen.set(chunk.documentId, chunk.supersededBy);
    }
  }
  return [...seen].map(([supersededId, supersededBy]) => ({ supersededId, supersededBy }));
}

export const DEFAULT_MATCH_COUNT = 12;

export async function retrieve(
  db: RetrievalDb,
  { query, embedding = null, matchCount = DEFAULT_MATCH_COUNT, rerank = {} }: RetrieveOptions,
): Promise<RetrievalResult> {
  const reference = findGoReference(query);

  if (reference !== null) {
    const { data, error } = await db.rpc("chunks_for_go_number", {
      go_number_query: reference.canonical,
      match_count: matchCount,
    });
    if (error) throw new Error(`chunks_for_go_number failed: ${error.message}`);

    const rows = (data ?? []) as SearchRow[];
    if (rows.length > 0) {
      // Already in document order and all from one GO, so reranking would only
      // shuffle a single order's paragraphs out of sequence.
      const chunks = rows.map(toChunk);
      return { mode: "go-number", chunks, supersessions: supersessionsIn(chunks) };
    }
    // The GO is named but not in the corpus — fall through, so the answer can
    // still be grounded in whatever discusses it rather than returning nothing.
  }

  const { data, error } = await db.rpc("search_chunks", {
    query_embedding: embedding,
    query_text: query,
    match_count: matchCount,
  });
  if (error) throw new Error(`search_chunks failed: ${error.message}`);

  const chunks = ((data ?? []) as SearchRow[]).map(toChunk);
  const top = rerankChunks(chunks, rerank);
  return { mode: "hybrid", chunks: top, supersessions: supersessionsIn(top) };
}

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TextChunk } from "../pipeline/types.js";

/**
 * Final pipeline stage (PLAN.md Part 2): chunks + vectors → the `chunks`
 * table, keyed to an approved document.
 *
 * Writing is delete-then-insert on the document, because re-embedding must be
 * idempotent: approve → fix metadata → re-approve is a real admin flow, and a
 * second pass with a different chunking must not leave stale rows from the
 * first pass sitting next to the new ones.
 */

/**
 * 50 rows × (~2k chars + a 1024-float vector) keeps each PostgREST request
 * around a megabyte — well inside default body limits, cheap to retry.
 */
export const CHUNK_INSERT_BATCH_SIZE = 50;

export async function writeChunks(
  db: SupabaseClient,
  documentId: string,
  chunks: TextChunk[],
  embeddings: number[][],
): Promise<{ written: number }> {
  if (chunks.length !== embeddings.length) {
    throw new Error(
      `chunk/embedding mismatch for document ${documentId}: ${chunks.length} chunks vs ` +
        `${embeddings.length} embeddings — refusing to write a partially embedded document`,
    );
  }

  // Rows are built (and validated) in full before anything is deleted, so a
  // bad input can never leave the document with no chunks at all.
  const rows = chunks.map((chunk, i) => {
    const embedding = embeddings[i];
    if (embedding === undefined) {
      throw new Error(`missing embedding for chunk seq ${chunk.seq} of document ${documentId}`);
    }
    return {
      document_id: documentId,
      seq: chunk.seq,
      content: chunk.content,
      embedding,
      page: chunk.page,
    };
  });

  const { error: deleteError } = await db.from("chunks").delete().eq("document_id", documentId);
  if (deleteError) {
    throw new Error(`chunks delete failed for document ${documentId}: ${deleteError.message}`);
  }

  for (let start = 0; start < rows.length; start += CHUNK_INSERT_BATCH_SIZE) {
    const batch = rows.slice(start, start + CHUNK_INSERT_BATCH_SIZE);
    const { error } = await db.from("chunks").insert(batch);
    if (error) {
      throw new Error(
        `chunks insert failed for document ${documentId} ` +
          `(rows ${start}–${start + batch.length - 1} of ${rows.length}): ${error.message}`,
      );
    }
  }

  return { written: rows.length };
}

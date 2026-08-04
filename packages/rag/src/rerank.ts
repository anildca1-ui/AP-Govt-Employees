import type { Citation, RetrievedChunk } from "./types.js";

/**
 * Reranking from the top-12 retrieved down to the 5 the model actually sees
 * (PLAN.md Phase 2).
 *
 * Not simply "take the highest five". Retrieval routinely returns five
 * consecutive chunks of one long GO, because a document that matches tends to
 * match repeatedly — and an answer built from five fragments of a single order
 * can only ever cite one GO. Service-rule questions usually need the order, its
 * amendment and the clarifying memo, so breadth across documents is worth more
 * than the marginal relevance of a fourth chunk from the same one.
 */

export const DEFAULT_RERANK_LIMIT = 5;
export const DEFAULT_MAX_PER_DOCUMENT = 2;

export interface RerankOptions {
  limit?: number;
  maxPerDocument?: number;
}

export function rerankChunks(
  chunks: RetrievedChunk[],
  { limit = DEFAULT_RERANK_LIMIT, maxPerDocument = DEFAULT_MAX_PER_DOCUMENT }: RerankOptions = {},
): RetrievedChunk[] {
  if (limit <= 0) return [];

  const ordered = [...chunks].sort((a, b) => b.score - a.score);
  const perDocument = new Map<string, number>();
  const picked: RetrievedChunk[] = [];
  const overflow: RetrievedChunk[] = [];

  for (const chunk of ordered) {
    const used = perDocument.get(chunk.documentId) ?? 0;
    if (used < maxPerDocument) {
      perDocument.set(chunk.documentId, used + 1);
      picked.push(chunk);
      if (picked.length === limit) return picked;
    } else {
      overflow.push(chunk);
    }
  }

  // Only when the corpus genuinely has nothing else to offer do we fall back to
  // extra chunks from documents already represented — an answer grounded in one
  // GO beats an answer grounded in four chunks and a gap.
  for (const chunk of overflow) {
    if (picked.length === limit) break;
    picked.push(chunk);
  }

  return picked;
}

/**
 * One citation per document, in the order the documents first appear, so the
 * citation list reads in the same order as the evidence.
 */
export function citationsFor(chunks: RetrievedChunk[]): Citation[] {
  const byDocument = new Map<string, Citation>();

  for (const chunk of chunks) {
    if (byDocument.has(chunk.documentId)) continue;
    byDocument.set(chunk.documentId, {
      documentId: chunk.documentId,
      goNumber: chunk.goNumber,
      issueDate: chunk.issueDate,
      subject: chunk.subject,
      pdfUrl: chunk.pdfUrl,
      supersededBy: chunk.supersededBy,
    });
  }

  return [...byDocument.values()];
}

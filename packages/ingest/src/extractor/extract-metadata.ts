import type { LlmClient, MetadataExtraction } from "../pipeline/types.js";
import { parseExtraction } from "./parse.js";
import { buildExtractionPrompt } from "./prompt.js";

/**
 * Stage 2 of the pipeline (PLAN.md Part 2): PDF + text → DocumentMetadata,
 * with an explicit needs-review verdict for the admin queue.
 */

export const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;

export interface ExtractMetadataInput {
  /** The original PDF bytes. */
  pdf: Uint8Array;
  /** Stage-1 extracted text; pass "" for scanned PDFs with no text layer. */
  text: string;
  llm: LlmClient;
  /** Extractions below this confidence are flagged for human review. */
  confidenceThreshold?: number;
}

export async function extractMetadata({
  pdf,
  text,
  llm,
  confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD,
}: ExtractMetadataInput): Promise<MetadataExtraction> {
  const raw = await llm.generate({
    prompt: buildExtractionPrompt(text),
    // The PDF is attached even when stage-1 text looks complete: vision reads
    // letterheads, seals and signature blocks that text extraction drops, and
    // those often carry the GO number and date.
    files: [{ mimeType: "application/pdf", data: pdf }],
    json: true,
  });

  const { metadata, problems } = parseExtraction(raw);

  // Each reason is written for the human reviewer in the admin queue — it is
  // the explanation of WHY the row landed on their desk.
  const reviewReasons: string[] = [];
  if (metadata.confidence < confidenceThreshold) {
    reviewReasons.push(
      `confidence ${metadata.confidence} is below the ${confidenceThreshold} review threshold`,
    );
  }
  // Without a number and date the document cannot be cited by a RAG answer
  // (quality rule 1), and without a subject it cannot be found in the library.
  if (metadata.go_number === null) reviewReasons.push("go_number could not be extracted");
  if (metadata.issue_date === null) reviewReasons.push("issue_date could not be extracted");
  if (metadata.subject === null) reviewReasons.push("subject could not be extracted");
  for (const problem of problems) {
    reviewReasons.push(`extractor output problem: ${problem}`);
  }

  return { metadata, needsReview: reviewReasons.length > 0, reviewReasons };
}

/**
 * Shared contracts for the ingestion pipeline (PLAN.md Part 2).
 *
 * Stage boundaries live here so each stage can be built and tested in
 * isolation: PDF → text → metadata → chunks → embeddings → database.
 */

import type { GoType } from "../goir/types.js";

// ─── Stage 1: PDF → text ────────────────────────────────────────────────────

export interface ExtractedPdf {
  /** Full text, pages joined with form-feed (\f) separators. */
  text: string;
  totalPages: number;
  /** Characters of extracted text per page, index 0 = page 1. */
  perPageChars: number[];
  /** True when the PDF is images with no usable text layer → needs OCR. */
  isScanned: boolean;
}

/**
 * OCR fallback for scanned PDFs. Two implementations planned:
 * Surya (stub until the Python worker exists) and Gemini vision (sends the PDF
 * bytes directly — Gemini reads PDFs natively, no rasterisation step).
 */
export interface OcrProvider {
  readonly name: string;
  /** Returns page texts, index 0 = page 1. Throws on failure. */
  recognize(pdf: Uint8Array): Promise<string[]>;
}

// ─── Stage 2: text → metadata ───────────────────────────────────────────────

/** What the vision-LLM extractor reads off the GO itself. */
export interface DocumentMetadata {
  go_number: string | null;
  go_type: GoType | null;
  dept: string | null;
  /** ISO yyyy-mm-dd. */
  issue_date: string | null;
  subject: string | null;
  subject_te: string | null;
  /** GO numbers (canonical text form) this order supersedes, per its own text. */
  supersedes: string[];
  /** 0..1 — extractor's own confidence. Below threshold → flag for review. */
  confidence: number;
}

export interface MetadataExtraction {
  metadata: DocumentMetadata;
  /** True when confidence < threshold or required fields are missing. */
  needsReview: boolean;
  /** Human-readable reasons a reviewer should look closely. */
  reviewReasons: string[];
}

/**
 * Minimal LLM client the extractor and OCR fallback share. Implementations are
 * fetch-based (no SDK): Gemini now, others env-switchable later.
 */
export interface LlmClient {
  readonly model: string;
  /**
   * Sends a prompt with optional inline file parts and returns the raw text of
   * the model's reply. JSON parsing/validation is the caller's job.
   */
  generate(request: {
    prompt: string;
    /** Inline binary parts, e.g. the PDF itself for vision extraction. */
    files?: { mimeType: string; data: Uint8Array }[];
    /** Ask the provider for a JSON response where supported. */
    json?: boolean;
  }): Promise<string>;
}

// ─── Stage 3: text → chunks ─────────────────────────────────────────────────

export interface ChunkInput {
  /** Text with \f page separators, as produced by stage 1 (or OCR). */
  text: string;
  /** Attached to every chunk so retrieval hits carry their provenance. */
  header: {
    go_number: string | null;
    dept: string | null;
    issue_date: string | null;
    subject: string | null;
  };
}

export interface TextChunk {
  /** 0-based order within the document. */
  seq: number;
  /** Chunk text including the provenance header line. */
  content: string;
  /** 1-based page the chunk starts on. */
  page: number;
}

// ─── Stage 4: chunks → vectors ──────────────────────────────────────────────

/**
 * Embedding provider, env-switchable (CLAUDE.md stack): OpenAI
 * text-embedding-3-large requested at 1024 dims, or BGE-M3 (1024 native).
 * chunks.embedding is vector(1024); anything else is a migration.
 */
export interface EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  /** One vector per input, same order. Throws on failure. */
  embed(texts: string[]): Promise<number[][]>;
}

export const EMBEDDING_DIMENSIONS = 1024;

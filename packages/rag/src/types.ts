/** A retrieved chunk with the document provenance every citation needs. */
export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  seq: number;
  content: string;
  page: number | null;
  goNumber: string | null;
  goType: string | null;
  dept: string | null;
  /** ISO yyyy-mm-dd. */
  issueDate: string | null;
  subject: string | null;
  subjectTe: string | null;
  pdfUrl: string | null;
  /** Set when a later GO supersedes this one (CLAUDE.md rule 3). */
  supersededBy: string | null;
  vectorScore: number;
  keywordScore: number;
  score: number;
}

/** How a result set was obtained — surfaced so the answer layer can explain itself. */
export type RetrievalMode = "go-number" | "hybrid";

export interface RetrievalResult {
  mode: RetrievalMode;
  chunks: RetrievedChunk[];
  /**
   * Documents among the results that a later GO supersedes, with the superseding
   * document when it too was retrievable. The answer must use the superseding
   * GO and say so.
   */
  supersessions: { supersededId: string; supersededBy: string }[];
}

/** The citation an answer must carry: GO number, date and link (rule 1). */
export interface Citation {
  documentId: string;
  goNumber: string | null;
  issueDate: string | null;
  subject: string | null;
  pdfUrl: string | null;
  supersededBy: string | null;
}

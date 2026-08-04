export { findGoReference, type GoReference, type GoType } from "./go-number.js";

export {
  retrieve,
  DEFAULT_MATCH_COUNT,
  type RetrievalDb,
  type RetrieveOptions,
} from "./retrieve.js";

export {
  citationsFor,
  rerankChunks,
  DEFAULT_RERANK_LIMIT,
  DEFAULT_MAX_PER_DOCUMENT,
  type RerankOptions,
} from "./rerank.js";

export type {
  Citation,
  RetrievalMode,
  RetrievalResult,
  RetrievedChunk,
} from "./types.js";

export {
  buildContext,
  formatChunk,
  formatGoDate,
  DISCLAIMER,
  NOT_FOUND_EN,
  NOT_FOUND_TE,
  SYSTEM_PROMPT,
} from "./answer/prompt.js";

export {
  streamAnswer,
  DEFAULT_ANSWER_MODEL,
  type StreamAnswerOptions,
} from "./answer/gemini-stream.js";

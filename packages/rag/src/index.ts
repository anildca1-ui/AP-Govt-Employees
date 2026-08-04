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

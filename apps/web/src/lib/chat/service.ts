import {
  buildContext,
  citationsFor,
  retrieve,
  streamAnswer,
  SYSTEM_PROMPT,
  type Citation,
  type RetrievalDb,
  type RetrievalResult,
} from "@ap-emp-ai/rag";

/**
 * The chat pipeline, kept out of the route handler so it can be tested without
 * a Next request: embed the question → retrieve → stream a grounded answer.
 */

export interface EmbedFn {
  (text: string): Promise<number[] | null>;
}

export interface ChatDeps {
  db: RetrievalDb;
  embed: EmbedFn;
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

export interface ChatRequest {
  question: string;
  signal?: AbortSignal;
}

export interface PreparedChat {
  retrieval: RetrievalResult;
  citations: Citation[];
  stream: AsyncGenerator<string, void, undefined>;
}

export const MAX_QUESTION_CHARS = 2000;

export class InvalidQuestionError extends Error {}

/**
 * Validates and normalises the question.
 *
 * Exported so the route can call it before it builds any clients. Constructing
 * those reads environment variables and throws when configuration is missing,
 * which would turn "you sent an empty question" into a 500 blaming our setup.
 * Cheap input validation belongs at the boundary, before any work.
 */
export function validateQuestion(question: unknown): string {
  if (typeof question !== "string") throw new InvalidQuestionError("Question must be a string");
  const trimmed = question.trim();
  if (trimmed === "") throw new InvalidQuestionError("Question is empty");
  if (trimmed.length > MAX_QUESTION_CHARS) {
    throw new InvalidQuestionError(`Question is longer than ${MAX_QUESTION_CHARS} characters`);
  }
  return trimmed;
}

/**
 * Retrieves, then returns the citations together with a not-yet-consumed answer
 * stream.
 *
 * Citations are resolved before a single token is generated, deliberately: the
 * UI shows which GOs the answer rests on while it is still being written, and
 * they are the same list the answer is grounded in rather than something parsed
 * back out of the model's prose.
 */
export async function prepareChat(
  deps: ChatDeps,
  { question, signal }: ChatRequest,
): Promise<PreparedChat> {
  // Defence in depth: the route validates before building clients, but
  // prepareChat is also called directly by the bots in Phase 4.
  const trimmed = validateQuestion(question);

  // A failed embedding degrades to keyword-only retrieval rather than failing
  // the request: a slightly worse answer beats no answer, and the keyword half
  // alone still finds GOs by number, department and subject.
  let embedding: number[] | null = null;
  try {
    embedding = await deps.embed(trimmed);
  } catch {
    embedding = null;
  }

  const retrieval = await retrieve(deps.db, { query: trimmed, embedding });

  const stream = streamAnswer({
    apiKey: deps.apiKey,
    ...(deps.model !== undefined && { model: deps.model }),
    systemPrompt: SYSTEM_PROMPT,
    userMessage: buildContext(retrieval, trimmed),
    ...(deps.fetchImpl !== undefined && { fetchImpl: deps.fetchImpl }),
    ...(signal !== undefined && { signal }),
  });

  return { retrieval, citations: citationsFor(retrieval.chunks), stream };
}

/**
 * Newline-delimited JSON, one event per line.
 *
 * NDJSON rather than the Vercel AI SDK's protocol or bare text: the client needs
 * the citations before the prose, and both bots (Phase 4) consume the same
 * endpoint without a React runtime to decode a bespoke format.
 */
export type ChatEvent =
  | { type: "citations"; citations: Citation[]; mode: RetrievalResult["mode"] }
  | { type: "token"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

export function encodeEvent(event: ChatEvent): string {
  return `${JSON.stringify(event)}\n`;
}

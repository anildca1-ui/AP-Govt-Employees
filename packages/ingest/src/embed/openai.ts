import { EMBEDDING_DIMENSIONS, type EmbeddingProvider } from "../pipeline/types.js";

/**
 * OpenAI embeddings, fetch-based like the Gemini client — no SDK, so tests
 * stub the transport and never touch the network.
 */

/**
 * Overridable via OPENAI_BASE_URL, matching the chat route and GEMINI_BASE_URL.
 * There are two embedding call sites — this one indexes documents, the chat
 * embeds the question — and if only one honours the override, the indexer
 * quietly still calls the real API. That is exactly what happened the first
 * time index:documents was run against stand-ins.
 */
export const OPENAI_EMBEDDINGS_URL = `${
  process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"
}/embeddings`;
export const DEFAULT_OPENAI_EMBEDDING_MODEL = "text-embedding-3-large";

/**
 * The API accepts up to 2048 inputs per request, but 100 chunks of ~2k chars
 * keeps each request body comfortably under proxy/body-size limits and makes a
 * mid-run failure cheap to retry.
 */
export const OPENAI_EMBED_BATCH_SIZE = 100;

export interface OpenAiEmbeddingsOptions {
  apiKey: string;
  model?: string;
  /** Injectable for tests; defaults to the platform fetch. */
  fetchImpl?: typeof fetch;
}

/** The slice of the embeddings response this provider reads. */
interface EmbeddingsResponse {
  data?: { index: number; embedding: number[] }[];
}

export class OpenAiEmbeddings implements EmbeddingProvider {
  readonly name = "openai";
  readonly dimensions: number = EMBEDDING_DIMENSIONS;
  readonly model: string;
  #apiKey: string;
  #fetch: typeof fetch;

  constructor({ apiKey, model = DEFAULT_OPENAI_EMBEDDING_MODEL, fetchImpl }: OpenAiEmbeddingsOptions) {
    this.model = model;
    this.#apiKey = apiKey;
    this.#fetch = fetchImpl ?? fetch;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const out: (number[] | undefined)[] = new Array<number[] | undefined>(texts.length);
    for (let start = 0; start < texts.length; start += OPENAI_EMBED_BATCH_SIZE) {
      const batch = texts.slice(start, start + OPENAI_EMBED_BATCH_SIZE);
      const response = await this.#fetch(OPENAI_EMBEDDINGS_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.#apiKey}`,
        },
        // `dimensions` is mandatory, not an optimisation: text-embedding-3-large
        // is 3072-d natively and chunks.embedding is vector(1024) (PLAN.md
        // Part 7) — without it every insert would fail.
        body: JSON.stringify({ model: this.model, input: batch, dimensions: this.dimensions }),
      });
      if (!response.ok) {
        const detail = snippet(await response.text());
        throw new Error(`OpenAI embeddings failed with HTTP ${response.status}: ${detail}`);
      }

      const payload = (await response.json()) as EmbeddingsResponse;
      const data = payload.data;
      if (data === undefined || data.length !== batch.length) {
        throw new Error(
          `OpenAI returned ${data?.length ?? 0} embeddings for a batch of ${batch.length}`,
        );
      }
      for (const item of data) {
        // The API does not promise response order; data[].index is the
        // contract that maps each vector back to its input.
        if (!Number.isInteger(item.index) || item.index < 0 || item.index >= batch.length) {
          throw new Error(`OpenAI returned an out-of-range embedding index ${item.index}`);
        }
        if (item.embedding.length !== this.dimensions) {
          throw new Error(
            `OpenAI returned a ${item.embedding.length}-d vector, expected ${this.dimensions} — ` +
              "chunks.embedding is vector(1024); check the dimensions parameter and model",
          );
        }
        out[start + item.index] = item.embedding;
      }
    }

    // An explicit loop, not out.map(): `out` is sparse (new Array(n) creates
    // holes, and a duplicated data[].index leaves one unfilled), and map skips
    // holes entirely — so the guard below would never run and the caller would
    // receive an array with an undefined slot in it.
    const vectors: number[][] = [];
    for (let i = 0; i < out.length; i++) {
      const vector = out[i];
      if (vector === undefined) {
        throw new Error(`OpenAI response carried no embedding for input ${i}`);
      }
      vectors.push(vector);
    }
    return vectors;
  }
}

/** Enough of an error body to act on, without dumping a whole HTML page. */
function snippet(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 300 ? `${flat.slice(0, 300)}…` : flat;
}

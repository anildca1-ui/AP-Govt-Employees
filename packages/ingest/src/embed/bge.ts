import { EMBEDDING_DIMENSIONS, type EmbeddingProvider } from "../pipeline/types.js";

/**
 * BGE-M3 via DeepInfra's inference endpoint — the env-switchable alternative
 * to OpenAI (CLAUDE.md stack). BGE-M3 is 1024-d natively, exactly the
 * chunks.embedding column width, so no dimensions parameter exists or is
 * needed; the response is still validated against it.
 */

export const DEEPINFRA_BGE_M3_URL = "https://api.deepinfra.com/v1/inference/BAAI/bge-m3";

/** Same batch size as the OpenAI provider, and for the same body-size reason. */
export const BGE_EMBED_BATCH_SIZE = 100;

export interface BgeM3EmbeddingsOptions {
  apiKey: string;
  /** Injectable for tests; defaults to the platform fetch. */
  fetchImpl?: typeof fetch;
}

/** The slice of DeepInfra's inference response this provider reads. */
interface InferenceResponse {
  embeddings?: number[][];
}

export class BgeM3Embeddings implements EmbeddingProvider {
  readonly name = "bge-m3";
  readonly dimensions: number = EMBEDDING_DIMENSIONS;
  #apiKey: string;
  #fetch: typeof fetch;

  constructor({ apiKey, fetchImpl }: BgeM3EmbeddingsOptions) {
    this.#apiKey = apiKey;
    this.#fetch = fetchImpl ?? fetch;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let start = 0; start < texts.length; start += BGE_EMBED_BATCH_SIZE) {
      const batch = texts.slice(start, start + BGE_EMBED_BATCH_SIZE);
      const response = await this.#fetch(DEEPINFRA_BGE_M3_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.#apiKey}`,
        },
        body: JSON.stringify({ inputs: batch }),
      });
      if (!response.ok) {
        const detail = snippet(await response.text());
        throw new Error(`DeepInfra bge-m3 failed with HTTP ${response.status}: ${detail}`);
      }

      const payload = (await response.json()) as InferenceResponse;
      const embeddings = payload.embeddings;
      // Unlike OpenAI there is no per-item index; the response is positional,
      // so an off-count batch cannot be repaired — only rejected.
      if (embeddings === undefined || embeddings.length !== batch.length) {
        throw new Error(
          `DeepInfra returned ${embeddings?.length ?? 0} embeddings for a batch of ${batch.length}`,
        );
      }
      for (const vector of embeddings) {
        if (vector.length !== this.dimensions) {
          throw new Error(
            `DeepInfra returned a ${vector.length}-d vector, expected ${this.dimensions} — ` +
              "chunks.embedding is vector(1024)",
          );
        }
        out.push(vector);
      }
    }
    return out;
  }
}

/** Enough of an error body to act on, without dumping a whole HTML page. */
function snippet(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 300 ? `${flat.slice(0, 300)}…` : flat;
}

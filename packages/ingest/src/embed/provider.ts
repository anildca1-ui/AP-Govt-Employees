import { EMBEDDING_DIMENSIONS, type EmbeddingProvider } from "../pipeline/types.js";
import { BgeM3Embeddings } from "./bge.js";
import { DEFAULT_OPENAI_EMBEDDING_MODEL, OpenAiEmbeddings } from "./openai.js";

/**
 * Builds the embedding provider from the environment described in
 * `.env.example` (EMBEDDING_PROVIDER / EMBEDDING_MODEL / keys). Validation
 * happens here rather than at the first request so a misconfigured pipeline
 * run fails before any document is processed — same stance as config.ts.
 */
export function createEmbeddingProvider(env: NodeJS.ProcessEnv = process.env): EmbeddingProvider {
  // Widened so TypeScript does not flag the comparison as impossible — the
  // point is to fail loudly if anyone ever edits the constant without the
  // migration + full re-embed that a new column width requires.
  const dimensions: number = EMBEDDING_DIMENSIONS;
  if (dimensions !== 1024) {
    throw new Error(
      `EMBEDDING_DIMENSIONS is ${dimensions} but chunks.embedding is vector(1024) — ` +
        "changing the dimension means a schema migration and re-embedding the whole corpus (PLAN.md Part 7)",
    );
  }
  const envDimensions = env.EMBEDDING_DIMENSIONS;
  if (envDimensions !== undefined && envDimensions.trim() !== "" && Number(envDimensions) !== dimensions) {
    throw new Error(
      `EMBEDDING_DIMENSIONS=${envDimensions} in the environment, but the corpus is embedded at ${dimensions} ` +
        "(chunks.embedding is vector(1024)) — remove the override or run the migration + re-embed first",
    );
  }

  // .env.example defaults to openai (the simpler start per PLAN.md Part 2).
  const provider = (env.EMBEDDING_PROVIDER ?? "").trim().toLowerCase() || "openai";
  switch (provider) {
    case "openai": {
      const apiKey = env.OPENAI_API_KEY;
      if (apiKey === undefined || apiKey.trim() === "") {
        throw new Error(
          "OPENAI_API_KEY is not set but EMBEDDING_PROVIDER is openai — " +
            "copy .env.example to .env and fill in OPENAI_API_KEY, or switch to EMBEDDING_PROVIDER=bge",
        );
      }
      const model = env.EMBEDDING_MODEL;
      return new OpenAiEmbeddings({
        apiKey,
        model: model !== undefined && model.trim() !== "" ? model : DEFAULT_OPENAI_EMBEDDING_MODEL,
      });
    }
    case "bge": {
      const apiKey = env.DEEPINFRA_API_KEY;
      if (apiKey === undefined || apiKey.trim() === "") {
        throw new Error(
          "DEEPINFRA_API_KEY is not set but EMBEDDING_PROVIDER is bge — " +
            "BGE-M3 runs via DeepInfra; copy .env.example to .env and fill in DEEPINFRA_API_KEY",
        );
      }
      return new BgeM3Embeddings({ apiKey });
    }
    default:
      throw new Error(
        `Unknown EMBEDDING_PROVIDER "${provider}" — expected "openai" or "bge" (see .env.example)`,
      );
  }
}

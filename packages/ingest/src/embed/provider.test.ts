import { describe, expect, it } from "vitest";
import { BgeM3Embeddings } from "./bge.js";
import { DEFAULT_OPENAI_EMBEDDING_MODEL, OpenAiEmbeddings } from "./openai.js";
import { createEmbeddingProvider } from "./provider.js";

const OPENAI_ENV = { EMBEDDING_PROVIDER: "openai", OPENAI_API_KEY: "sk-test" };
const BGE_ENV = { EMBEDDING_PROVIDER: "bge", DEEPINFRA_API_KEY: "di-test" };

describe("createEmbeddingProvider", () => {
  it("builds the OpenAI provider with the default model", () => {
    const provider = createEmbeddingProvider(OPENAI_ENV);

    expect(provider).toBeInstanceOf(OpenAiEmbeddings);
    expect(provider.dimensions).toBe(1024);
    expect((provider as OpenAiEmbeddings).model).toBe(DEFAULT_OPENAI_EMBEDDING_MODEL);
  });

  it("respects EMBEDDING_MODEL for OpenAI", () => {
    const provider = createEmbeddingProvider({
      ...OPENAI_ENV,
      EMBEDDING_MODEL: "text-embedding-3-small",
    });

    expect((provider as OpenAiEmbeddings).model).toBe("text-embedding-3-small");
  });

  it("builds the BGE-M3 provider", () => {
    const provider = createEmbeddingProvider(BGE_ENV);

    expect(provider).toBeInstanceOf(BgeM3Embeddings);
    expect(provider.dimensions).toBe(1024);
  });

  it("defaults to openai when EMBEDDING_PROVIDER is unset or blank", () => {
    expect(createEmbeddingProvider({ OPENAI_API_KEY: "sk-test" })).toBeInstanceOf(OpenAiEmbeddings);
    expect(
      createEmbeddingProvider({ EMBEDDING_PROVIDER: "  ", OPENAI_API_KEY: "sk-test" }),
    ).toBeInstanceOf(OpenAiEmbeddings);
  });

  it("ignores case and whitespace in the provider name", () => {
    expect(
      createEmbeddingProvider({ EMBEDDING_PROVIDER: " OpenAI ", OPENAI_API_KEY: "sk-test" }),
    ).toBeInstanceOf(OpenAiEmbeddings);
  });

  it("throws actionably when the OpenAI key is missing", () => {
    expect(() => createEmbeddingProvider({ EMBEDDING_PROVIDER: "openai" })).toThrow(
      /OPENAI_API_KEY/,
    );
    expect(() =>
      createEmbeddingProvider({ EMBEDDING_PROVIDER: "openai", OPENAI_API_KEY: "  " }),
    ).toThrow(/OPENAI_API_KEY/);
  });

  it("throws actionably when the DeepInfra key is missing", () => {
    expect(() => createEmbeddingProvider({ EMBEDDING_PROVIDER: "bge" })).toThrow(
      /DEEPINFRA_API_KEY/,
    );
  });

  it("rejects an unknown provider by name", () => {
    expect(() => createEmbeddingProvider({ EMBEDDING_PROVIDER: "cohere" })).toThrow(
      /EMBEDDING_PROVIDER "cohere"/,
    );
    expect(() => createEmbeddingProvider({ EMBEDDING_PROVIDER: "cohere" })).toThrow(/openai/);
  });

  it("rejects an EMBEDDING_DIMENSIONS override that is not 1024", () => {
    // chunks.embedding is vector(1024); a different dimension is a schema
    // migration plus a full re-embed, never a config flip.
    expect(() =>
      createEmbeddingProvider({ ...OPENAI_ENV, EMBEDDING_DIMENSIONS: "1536" }),
    ).toThrow(/1024/);
  });

  it("accepts EMBEDDING_DIMENSIONS=1024 and an empty override", () => {
    expect(
      createEmbeddingProvider({ ...OPENAI_ENV, EMBEDDING_DIMENSIONS: "1024" }),
    ).toBeInstanceOf(OpenAiEmbeddings);
    expect(createEmbeddingProvider({ ...OPENAI_ENV, EMBEDDING_DIMENSIONS: "" })).toBeInstanceOf(
      OpenAiEmbeddings,
    );
  });
});

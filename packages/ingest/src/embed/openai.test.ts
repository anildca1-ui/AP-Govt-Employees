import { describe, expect, it } from "vitest";
import {
  DEFAULT_OPENAI_EMBEDDING_MODEL,
  OPENAI_EMBED_BATCH_SIZE,
  OPENAI_EMBEDDINGS_URL,
  OpenAiEmbeddings,
} from "./openai.js";

interface RecordedCall {
  url: string;
  init: RequestInit;
}

interface SentBody {
  model: string;
  input: string[];
  dimensions?: number;
}

/** A 1024-d vector whose first component tags which input produced it. */
function vectorFor(tag: number, length = 1024): number[] {
  const vector = new Array<number>(length).fill(0);
  vector[0] = tag;
  return vector;
}

/**
 * Echo server: embeds "t<N>" as a vector tagged N. Optionally shuffles the
 * data array, because the provider must rely on data[].index, not order.
 */
function stubFetch(
  options: {
    status?: number;
    rawBody?: string;
    vectorLength?: number;
    reorder?: boolean;
  } = {},
): { calls: RecordedCall[]; impl: typeof fetch } {
  const calls: RecordedCall[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), init: init ?? {} });
    const status = options.status ?? 200;
    let bodyText = options.rawBody;
    if (bodyText === undefined) {
      const body = JSON.parse(String(init?.body)) as SentBody;
      const data = body.input.map((text, index) => ({
        index,
        embedding: vectorFor(Number(text.replace(/\D/g, "")), options.vectorLength ?? 1024),
      }));
      if (options.reorder === true) data.reverse();
      bodyText = JSON.stringify({ data });
    }
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => bodyText,
      json: async () => JSON.parse(bodyText) as unknown,
    } as unknown as Response;
  }) as typeof fetch;
  return { calls, impl };
}

function sentBody(call: RecordedCall): SentBody {
  return JSON.parse(String(call.init.body)) as SentBody;
}

describe("OpenAiEmbeddings", () => {
  it("POSTs to the embeddings endpoint with Bearer auth and mandatory dimensions", async () => {
    const { calls, impl } = stubFetch();
    const provider = new OpenAiEmbeddings({ apiKey: "sk-test", fetchImpl: impl });

    await provider.embed(["t1", "t2"]);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(OPENAI_EMBEDDINGS_URL);
    expect(calls[0]!.init.method).toBe("POST");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-test");
    expect(sentBody(calls[0]!)).toEqual({
      model: DEFAULT_OPENAI_EMBEDDING_MODEL,
      input: ["t1", "t2"],
      // vector(1024) column: text-embedding-3-large is 3072-d without this.
      dimensions: 1024,
    });
  });

  it("sends the configured model", async () => {
    const { calls, impl } = stubFetch();
    const provider = new OpenAiEmbeddings({
      apiKey: "sk-test",
      model: "text-embedding-3-small",
      fetchImpl: impl,
    });

    await provider.embed(["t1"]);

    expect(sentBody(calls[0]!).model).toBe("text-embedding-3-small");
  });

  it("splits >100 inputs into batches and reassembles them in input order", async () => {
    const { calls, impl } = stubFetch({ reorder: true });
    const provider = new OpenAiEmbeddings({ apiKey: "sk-test", fetchImpl: impl });
    const texts = Array.from({ length: 250 }, (_, i) => `t${i}`);

    const result = await provider.embed(texts);

    expect(calls).toHaveLength(3);
    expect(calls.map((call) => sentBody(call).input.length)).toEqual([
      OPENAI_EMBED_BATCH_SIZE,
      OPENAI_EMBED_BATCH_SIZE,
      50,
    ]);
    // Despite the shuffled responses, vector i belongs to input i.
    expect(result).toHaveLength(250);
    expect(result.map((vector) => vector[0])).toEqual(texts.map((_, i) => i));
  });

  it("throws when a returned vector is not 1024-d", async () => {
    const { impl } = stubFetch({ vectorLength: 8 });
    const provider = new OpenAiEmbeddings({ apiKey: "sk-test", fetchImpl: impl });

    await expect(provider.embed(["t1"])).rejects.toThrow(/1024/);
  });

  it("throws when the response skips an input", async () => {
    const { impl } = stubFetch({
      rawBody: JSON.stringify({
        data: [
          { index: 0, embedding: vectorFor(0) },
          { index: 0, embedding: vectorFor(0) },
        ],
      }),
    });
    const provider = new OpenAiEmbeddings({ apiKey: "sk-test", fetchImpl: impl });

    await expect(provider.embed(["t1", "t2"])).rejects.toThrow(/no embedding for input 1/);
  });

  it("surfaces HTTP errors with the status and body detail", async () => {
    const { impl } = stubFetch({
      status: 401,
      rawBody: '{"error":{"message":"Incorrect API key provided"}}',
    });
    const provider = new OpenAiEmbeddings({ apiKey: "sk-bad", fetchImpl: impl });

    await expect(provider.embed(["t1"])).rejects.toThrow(/HTTP 401/);
    await expect(provider.embed(["t1"])).rejects.toThrow(/Incorrect API key/);
  });

  it("makes no request for an empty input list", async () => {
    const { calls, impl } = stubFetch();
    const provider = new OpenAiEmbeddings({ apiKey: "sk-test", fetchImpl: impl });

    await expect(provider.embed([])).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

import { describe, expect, it } from "vitest";
import { BGE_EMBED_BATCH_SIZE, BgeM3Embeddings, DEEPINFRA_BGE_M3_URL } from "./bge.js";

interface RecordedCall {
  url: string;
  init: RequestInit;
}

interface SentBody {
  inputs: string[];
}

/** A 1024-d vector whose first component tags which input produced it. */
function vectorFor(tag: number, length = 1024): number[] {
  const vector = new Array<number>(length).fill(0);
  vector[0] = tag;
  return vector;
}

/** Echo server: embeds "t<N>" as a vector tagged N, in request order. */
function stubFetch(
  options: { status?: number; rawBody?: string; vectorLength?: number } = {},
): { calls: RecordedCall[]; impl: typeof fetch } {
  const calls: RecordedCall[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), init: init ?? {} });
    const status = options.status ?? 200;
    let bodyText = options.rawBody;
    if (bodyText === undefined) {
      const body = JSON.parse(String(init?.body)) as SentBody;
      const embeddings = body.inputs.map((text) =>
        vectorFor(Number(text.replace(/\D/g, "")), options.vectorLength ?? 1024),
      );
      bodyText = JSON.stringify({ embeddings });
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

describe("BgeM3Embeddings", () => {
  it("POSTs the batch to DeepInfra's bge-m3 endpoint with Bearer auth", async () => {
    const { calls, impl } = stubFetch();
    const provider = new BgeM3Embeddings({ apiKey: "di-test", fetchImpl: impl });

    await provider.embed(["t1", "t2"]);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(DEEPINFRA_BGE_M3_URL);
    expect(calls[0]!.init.method).toBe("POST");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer di-test");
    // BGE-M3 is 1024-d natively — the body is only the inputs, no dimensions.
    expect(sentBody(calls[0]!)).toEqual({ inputs: ["t1", "t2"] });
  });

  it("splits >100 inputs into batches and keeps input order", async () => {
    const { calls, impl } = stubFetch();
    const provider = new BgeM3Embeddings({ apiKey: "di-test", fetchImpl: impl });
    const texts = Array.from({ length: 250 }, (_, i) => `t${i}`);

    const result = await provider.embed(texts);

    expect(calls).toHaveLength(3);
    expect(calls.map((call) => sentBody(call).inputs.length)).toEqual([
      BGE_EMBED_BATCH_SIZE,
      BGE_EMBED_BATCH_SIZE,
      50,
    ]);
    expect(result).toHaveLength(250);
    expect(result.map((vector) => vector[0])).toEqual(texts.map((_, i) => i));
  });

  it("throws when a returned vector is not 1024-d", async () => {
    const { impl } = stubFetch({ vectorLength: 768 });
    const provider = new BgeM3Embeddings({ apiKey: "di-test", fetchImpl: impl });

    await expect(provider.embed(["t1"])).rejects.toThrow(/1024/);
  });

  it("throws when the embedding count does not match the batch", async () => {
    const { impl } = stubFetch({ rawBody: JSON.stringify({ embeddings: [vectorFor(0)] }) });
    const provider = new BgeM3Embeddings({ apiKey: "di-test", fetchImpl: impl });

    await expect(provider.embed(["t1", "t2"])).rejects.toThrow(/1 embeddings for a batch of 2/);
  });

  it("surfaces HTTP errors with the status and body detail", async () => {
    const { impl } = stubFetch({ status: 503, rawBody: "upstream overloaded" });
    const provider = new BgeM3Embeddings({ apiKey: "di-test", fetchImpl: impl });

    await expect(provider.embed(["t1"])).rejects.toThrow(/HTTP 503/);
    await expect(provider.embed(["t1"])).rejects.toThrow(/overloaded/);
  });

  it("makes no request for an empty input list", async () => {
    const { calls, impl } = stubFetch();
    const provider = new BgeM3Embeddings({ apiKey: "di-test", fetchImpl: impl });

    await expect(provider.embed([])).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

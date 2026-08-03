import { describe, expect, it } from "vitest";
import { createLlmFromEnv, DEFAULT_GEMINI_MODEL, GeminiClient } from "./gemini.js";

/** The slice of the generateContent request body the tests inspect. */
interface SentPart {
  text?: string;
  inline_data?: { mime_type: string; data: string };
}
interface SentBody {
  contents: { parts: SentPart[] }[];
  generationConfig?: { responseMimeType: string };
}

interface RecordedCall {
  url: string;
  init: RequestInit;
}

function reply(text: string): unknown {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

function stubFetch(
  options: { status?: number; payload?: unknown; rawBody?: string } = {},
): { calls: RecordedCall[]; impl: typeof fetch } {
  const calls: RecordedCall[] = [];
  const status = options.status ?? 200;
  const bodyText = options.rawBody ?? JSON.stringify(options.payload ?? reply("ok"));
  const impl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), init: init ?? {} });
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

describe("GeminiClient", () => {
  it("POSTs to the model's generateContent endpoint with header auth", async () => {
    const { calls, impl } = stubFetch();
    const client = new GeminiClient({ apiKey: "test-key", model: "gemini-x", fetchImpl: impl });

    await client.generate({ prompt: "hello" });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent",
    );
    expect(calls[0]!.init.method).toBe("POST");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("test-key");
    // The key must never travel in the URL, where proxies and logs would see it.
    expect(calls[0]!.url).not.toContain("test-key");
    expect(sentBody(calls[0]!).contents[0]!.parts[0]).toEqual({ text: "hello" });
  });

  it("defaults the model to gemini-2.5-flash", () => {
    const client = new GeminiClient({ apiKey: "k" });
    expect(client.model).toBe(DEFAULT_GEMINI_MODEL);
  });

  it("inlines file bytes as base64 that decode back to the original", async () => {
    const { calls, impl } = stubFetch();
    const client = new GeminiClient({ apiKey: "k", fetchImpl: impl });
    // Includes 0x00 and 0xff so a utf-8/base64 mixup cannot slip through.
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x7f]);

    await client.generate({ prompt: "read this", files: [{ mimeType: "application/pdf", data: pdf }] });

    const parts = sentBody(calls[0]!).contents[0]!.parts;
    expect(parts).toHaveLength(2);
    expect(parts[1]!.inline_data!.mime_type).toBe("application/pdf");
    expect(new Uint8Array(Buffer.from(parts[1]!.inline_data!.data, "base64"))).toEqual(pdf);
  });

  it("asks for a JSON response only when json is set", async () => {
    const { calls, impl } = stubFetch();
    const client = new GeminiClient({ apiKey: "k", fetchImpl: impl });

    await client.generate({ prompt: "p", json: true });
    await client.generate({ prompt: "p" });

    expect(sentBody(calls[0]!).generationConfig).toEqual({
      responseMimeType: "application/json",
    });
    expect(sentBody(calls[1]!).generationConfig).toBeUndefined();
  });

  it("joins the text of every part in the first candidate", async () => {
    const { impl } = stubFetch({
      payload: {
        candidates: [{ content: { parts: [{ text: '{"a":' }, { text: "1}" }] } }],
      },
    });
    const client = new GeminiClient({ apiKey: "k", fetchImpl: impl });

    await expect(client.generate({ prompt: "p" })).resolves.toBe('{"a":1}');
  });

  it("throws with the status and a body snippet on a 4xx", async () => {
    const { impl } = stubFetch({
      status: 400,
      rawBody: '{"error":{"message":"API key not valid"}}',
    });
    const client = new GeminiClient({ apiKey: "bad", fetchImpl: impl });

    await expect(client.generate({ prompt: "p" })).rejects.toThrow(/HTTP 400/);
    await expect(client.generate({ prompt: "p" })).rejects.toThrow(/API key not valid/);
  });

  it("throws with the status and a body snippet on a 5xx", async () => {
    const { impl } = stubFetch({ status: 503, rawBody: "The model is overloaded" });
    const client = new GeminiClient({ apiKey: "k", fetchImpl: impl });

    await expect(client.generate({ prompt: "p" })).rejects.toThrow(/HTTP 503/);
    await expect(client.generate({ prompt: "p" })).rejects.toThrow(/overloaded/);
  });

  it("throws when the response carries no candidates", async () => {
    const { impl } = stubFetch({ payload: { candidates: [] } });
    const client = new GeminiClient({ apiKey: "k", fetchImpl: impl });

    await expect(client.generate({ prompt: "p" })).rejects.toThrow(/no candidates/);
  });
});

describe("createLlmFromEnv", () => {
  it("throws an actionable error when GEMINI_API_KEY is unset", () => {
    expect(() => createLlmFromEnv({})).toThrow(/GEMINI_API_KEY/);
    expect(() => createLlmFromEnv({})).toThrow(/\.env/);
    expect(() => createLlmFromEnv({ GEMINI_API_KEY: "  " })).toThrow(/GEMINI_API_KEY/);
  });

  it("reads the model from LLM_MODEL", () => {
    const client = createLlmFromEnv({ GEMINI_API_KEY: "k", LLM_MODEL: "gemini-3.0-pro" });
    expect(client.model).toBe("gemini-3.0-pro");
  });

  it("falls back to the default model when LLM_MODEL is unset", () => {
    expect(createLlmFromEnv({ GEMINI_API_KEY: "k" }).model).toBe(DEFAULT_GEMINI_MODEL);
  });
});

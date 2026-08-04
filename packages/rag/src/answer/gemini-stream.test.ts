import { describe, expect, it } from "vitest";
import { streamAnswer } from "./gemini-stream.js";

/** Builds an SSE body from frames, optionally splitting mid-frame. */
function sseResponse(frames: string[], splitAt?: number): Response {
  const body = frames.map((f) => `data: ${f}\n\n`).join("");
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (splitAt === undefined) {
        controller.enqueue(encoder.encode(body));
      } else {
        controller.enqueue(encoder.encode(body.slice(0, splitAt)));
        controller.enqueue(encoder.encode(body.slice(splitAt)));
      }
      controller.close();
    },
  });

  return new Response(stream, { status: 200 });
}

function frame(text: string): string {
  return JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] });
}

async function collect(gen: AsyncGenerator<string>): Promise<string> {
  let out = "";
  for await (const piece of gen) out += piece;
  return out;
}

const BASE = {
  apiKey: "test-key",
  systemPrompt: "system",
  userMessage: "question",
};

describe("streamAnswer", () => {
  it("yields text as frames arrive", async () => {
    const fetchImpl = (async () =>
      sseResponse([frame("DA is "), frame("37.31%")])) as unknown as typeof fetch;

    const pieces: string[] = [];
    for await (const piece of streamAnswer({ ...BASE, fetchImpl })) pieces.push(piece);

    expect(pieces).toEqual(["DA is ", "37.31%"]);
  });

  it("reassembles a frame split across network chunks", async () => {
    // A chunk boundary lands mid-JSON; parsing per-chunk would drop the frame.
    const body = `data: ${frame("full answer text")}\n\n`;
    const fetchImpl = (async () =>
      sseResponse([frame("full answer text")], Math.floor(body.length / 2))) as unknown as typeof fetch;

    expect(await collect(streamAnswer({ ...BASE, fetchImpl }))).toBe("full answer text");
  });

  it("ignores keepalives and non-JSON frames rather than failing", async () => {
    const fetchImpl = (async () => {
      const body = `: keepalive\n\ndata: ${frame("answer")}\n\ndata: [DONE]\n\n`;
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;

    expect(await collect(streamAnswer({ ...BASE, fetchImpl }))).toBe("answer");
  });

  it("skips frames that carry no text part", async () => {
    const fetchImpl = (async () =>
      sseResponse([
        JSON.stringify({ candidates: [{ content: { parts: [] } }] }),
        frame("real text"),
      ])) as unknown as typeof fetch;

    expect(await collect(streamAnswer({ ...BASE, fetchImpl }))).toBe("real text");
  });

  it("requests SSE streaming with the configured model and key in the header", async () => {
    let seenUrl = "";
    let seenHeaders: Record<string, string> = {};
    let seenBody: Record<string, unknown> = {};
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seenUrl = url;
      seenHeaders = init.headers as Record<string, string>;
      seenBody = JSON.parse(init.body as string) as Record<string, unknown>;
      return sseResponse([frame("x")]);
    }) as unknown as typeof fetch;

    await collect(streamAnswer({ ...BASE, model: "gemini-2.5-flash", fetchImpl }));

    expect(seenUrl).toContain("gemini-2.5-flash:streamGenerateContent");
    expect(seenUrl).toContain("alt=sse");
    // The key belongs in the header, never the URL, where it would land in logs.
    expect(seenHeaders["x-goog-api-key"]).toBe("test-key");
    expect(seenUrl).not.toContain("test-key");
    expect(seenBody.systemInstruction).toEqual({ parts: [{ text: "system" }] });
  });

  it("keeps the temperature near zero — paraphrasing a GO is a defect", async () => {
    let body: { generationConfig?: { temperature?: number } } = {};
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(init.body as string) as typeof body;
      return sseResponse([frame("x")]);
    }) as unknown as typeof fetch;

    await collect(streamAnswer({ ...BASE, fetchImpl }));

    expect(body.generationConfig?.temperature).toBeLessThanOrEqual(0.2);
  });

  it("surfaces an HTTP error with status and body detail", async () => {
    const fetchImpl = (async () =>
      new Response('{"error":{"message":"quota exceeded"}}', { status: 429 })) as unknown as typeof fetch;

    await expect(collect(streamAnswer({ ...BASE, fetchImpl }))).rejects.toThrow(
      /HTTP 429.*quota exceeded/,
    );
  });

  it("fails loudly on an empty body instead of yielding nothing", async () => {
    const fetchImpl = (async () => new Response(null, { status: 200 })) as unknown as typeof fetch;

    await expect(collect(streamAnswer({ ...BASE, fetchImpl }))).rejects.toThrow(/empty response/);
  });
});

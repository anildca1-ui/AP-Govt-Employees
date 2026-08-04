import { describe, expect, it } from "vitest";
import { readNdjson, type ChatEvent } from "./ndjson";

function streamOf(text: string, splitAt?: number): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      if (splitAt === undefined) {
        controller.enqueue(encoder.encode(text));
      } else {
        controller.enqueue(encoder.encode(text.slice(0, splitAt)));
        controller.enqueue(encoder.encode(text.slice(splitAt)));
      }
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  for await (const event of readNdjson(stream)) events.push(event);
  return events;
}

describe("readNdjson", () => {
  it("yields one event per line", async () => {
    const body =
      '{"type":"citations","citations":[],"mode":"hybrid"}\n' +
      '{"type":"token","text":"DA is "}\n' +
      '{"type":"token","text":"37.31%"}\n' +
      '{"type":"done","logId":"log-1"}\n';

    const events = await collect(streamOf(body));

    expect(events.map((e) => e.type)).toEqual(["citations", "token", "token", "done"]);
  });

  it("reassembles a line split across network chunks", async () => {
    // The citations event is the one most likely to be large enough to split,
    // and losing it would render an answer with no sources at all.
    const body = '{"type":"citations","citations":[{"goNumber":"G.O.Ms.No.60"}],"mode":"hybrid"}\n';

    const events = await collect(streamOf(body, 40));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "citations" });
  });

  it("handles a final line with no trailing newline", async () => {
    const events = await collect(streamOf('{"type":"done","logId":null}'));
    expect(events[0]).toEqual({ type: "done", logId: null });
  });

  it("skips a malformed line instead of failing the answer", async () => {
    const body = 'not json\n{"type":"token","text":"ok"}\n';
    const events = await collect(streamOf(body));

    expect(events).toEqual([{ type: "token", text: "ok" }]);
  });

  it("preserves Telugu text and embedded newlines", async () => {
    const text = "కరువు భత్యం\n37.31%";
    const body = `${JSON.stringify({ type: "token", text })}\n`;

    const [event] = await collect(streamOf(body));

    expect(event).toEqual({ type: "token", text });
  });

  it("yields nothing for an empty stream", async () => {
    expect(await collect(streamOf(""))).toEqual([]);
  });
});

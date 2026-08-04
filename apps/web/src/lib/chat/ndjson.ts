import type { Citation, RetrievalMode } from "@ap-emp-ai/rag";

/** Mirror of the server's ChatEvent, for the browser. */
export type ChatEvent =
  | { type: "citations"; citations: Citation[]; mode: RetrievalMode }
  | { type: "token"; text: string }
  | { type: "done"; logId: string | null }
  | { type: "error"; message: string };

/**
 * Splits an NDJSON byte stream into events.
 *
 * The buffer matters: a network chunk boundary falls wherever TCP decides, so a
 * single JSON line is routinely delivered in two pieces. Parsing per-chunk would
 * drop those events — and since one of them carries the citations, the answer
 * would silently render with no sources.
 */
export async function* readNdjson(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<ChatEvent, void, undefined> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        const event = parseEvent(line);
        if (event !== null) yield event;
        newline = buffer.indexOf("\n");
      }
    }
    // A final line with no trailing newline still carries an event.
    const tail = parseEvent(buffer.trim());
    if (tail !== null) yield tail;
  } finally {
    reader.releaseLock();
  }
}

function parseEvent(line: string): ChatEvent | null {
  if (line === "") return null;
  try {
    return JSON.parse(line) as ChatEvent;
  } catch {
    // A malformed line is not worth failing a whole answer over.
    return null;
  }
}

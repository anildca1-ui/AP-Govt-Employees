/**
 * Streaming answer generation via the Gemini API.
 *
 * fetch-based with no SDK, matching the ingest package's client, so tests stub
 * the transport and nothing here touches the network.
 */

export interface StreamAnswerOptions {
  apiKey: string;
  model?: string;
  systemPrompt: string;
  userMessage: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

export const DEFAULT_ANSWER_MODEL = "gemini-2.5-flash";

/**
 * Overridable so the answer path can be exercised without calling Google — and
 * so a deployment behind a corporate proxy or a regional endpoint does not need
 * a code change. Unset, it is the real API.
 */
const API_BASE =
  process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Yields answer text as it arrives.
 *
 * Uses streamGenerateContent with alt=sse: the model takes seconds to produce a
 * full answer, and a reader on a phone watching a blank screen assumes the site
 * is broken.
 */
export async function* streamAnswer(
  options: StreamAnswerOptions,
): AsyncGenerator<string, void, undefined> {
  const {
    apiKey,
    model = DEFAULT_ANSWER_MODEL,
    systemPrompt,
    userMessage,
    fetchImpl = fetch,
    signal,
  } = options;

  const response = await fetchImpl(
    `${API_BASE}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userMessage }] }],
        generationConfig: {
          // Near-zero: this is a citation task, and creative paraphrase of a
          // government order is a defect.
          temperature: 0.1,
          maxOutputTokens: 2048,
        },
      }),
      ...(signal !== undefined && { signal }),
    },
  );

  if (!response.ok) {
    const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 300);
    throw new Error(`Gemini streaming failed with HTTP ${response.status}: ${detail}`);
  }
  if (response.body === null) throw new Error("Gemini returned an empty response body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line; a chunk boundary can land
      // mid-frame, so only complete frames are consumed.
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const text = textFromFrame(frame);
        if (text !== null) yield text;
        boundary = buffer.indexOf("\n\n");
      }
    }
    const tail = textFromFrame(buffer);
    if (tail !== null) yield tail;
  } finally {
    reader.releaseLock();
  }
}

/** Extracts the text parts of one SSE frame, or null when it carries none. */
function textFromFrame(frame: string): string | null {
  const payload = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("");

  if (payload === "" || payload === "[DONE]") return null;

  try {
    const parsed = JSON.parse(payload) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = (parsed.candidates ?? [])
      .flatMap((candidate) => candidate.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("");
    return text === "" ? null : text;
  } catch {
    // A frame that is not JSON is a keepalive or a partial write, not a failure.
    return null;
  }
}

import type { LlmClient } from "../pipeline/types.js";

/**
 * Fetch-based Gemini client — deliberately no SDK (CLAUDE.md stack keeps the
 * LLM env-switchable, and a bare HTTP call is trivial to stub in tests, which
 * must never touch the network).
 */

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export interface GeminiClientOptions {
  apiKey: string;
  model?: string;
  /** Injectable for tests; defaults to the platform fetch. */
  fetchImpl?: typeof fetch;
}

/** The slice of generateContent's response shape this client reads. */
interface GenerateContentResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

export class GeminiClient implements LlmClient {
  readonly model: string;
  #apiKey: string;
  #fetch: typeof fetch;

  constructor({ apiKey, model = DEFAULT_GEMINI_MODEL, fetchImpl }: GeminiClientOptions) {
    this.model = model;
    this.#apiKey = apiKey;
    this.#fetch = fetchImpl ?? fetch;
  }

  async generate(request: {
    prompt: string;
    files?: { mimeType: string; data: Uint8Array }[];
    json?: boolean;
  }): Promise<string> {
    const parts: Record<string, unknown>[] = [{ text: request.prompt }];
    for (const file of request.files ?? []) {
      parts.push({
        inline_data: {
          mime_type: file.mimeType,
          data: Buffer.from(file.data).toString("base64"),
        },
      });
    }

    const body: Record<string, unknown> = { contents: [{ parts }] };
    if (request.json === true) {
      // Native JSON mode beats prompt-begging: replies arrive fence-free, so
      // the parser's markdown tolerance becomes a fallback, not the main path.
      body.generationConfig = { responseMimeType: "application/json" };
    }

    const response = await this.#fetch(`${API_BASE}/${this.model}:generateContent`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Header auth, not ?key= — query strings end up in logs (rule 7).
        "x-goog-api-key": this.#apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const detail = snippet(await response.text());
      throw new Error(`Gemini generateContent failed with HTTP ${response.status}: ${detail}`);
    }

    const payload = (await response.json()) as GenerateContentResponse;
    const replyParts = payload.candidates?.[0]?.content?.parts;
    if (replyParts === undefined || replyParts.length === 0) {
      throw new Error(
        "Gemini returned no candidates — likely a safety block or an empty response",
      );
    }
    return replyParts.map((part) => part.text ?? "").join("");
  }
}

/** Enough of an error body to act on, without dumping a whole HTML page. */
function snippet(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 300 ? `${flat.slice(0, 300)}…` : flat;
}

/**
 * Builds the client from the environment described in `.env.example`
 * (LLM_MODEL / GEMINI_API_KEY). Validation happens here rather than at the
 * first request so a misconfigured pipeline run fails before downloading
 * anything — same stance as config.ts.
 */
export function createLlmFromEnv(env: NodeJS.ProcessEnv = process.env): GeminiClient {
  const apiKey = env.GEMINI_API_KEY;
  if (apiKey === undefined || apiKey.trim() === "") {
    throw new Error(
      "GEMINI_API_KEY is not set — metadata extraction sends each GO PDF to Gemini. " +
        "Copy .env.example to .env and fill in GEMINI_API_KEY.",
    );
  }

  const model = env.LLM_MODEL;
  return new GeminiClient({
    apiKey,
    model: model !== undefined && model.trim() !== "" ? model : DEFAULT_GEMINI_MODEL,
  });
}

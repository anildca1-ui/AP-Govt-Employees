import type { OcrProvider } from "../../pipeline/types.js";

/**
 * Surya OCR — a stub against the future Python worker. Vercel cannot run Surya
 * (PLAN.md Part 7, "Hosting of the OCR worker"): recognition happens in a
 * separate service or GitHub Action under `packages/ocr-worker`. This class
 * already speaks that worker's wire contract, so deploying it later is purely
 * a configuration change — set the endpoint, nothing here moves.
 *
 * Wire contract the worker must implement:
 *   POST <endpoint>, raw PDF bytes as the body, `Content-Type: application/pdf`
 *   → 200 with JSON `{ "pages": ["page 1 text", ...] }` in document order.
 * Raw body rather than multipart: the PDF is the whole payload, and one less
 * encoding for the Python side to unpick.
 */

export interface SuryaOcrOptions {
  /** Worker URL. Left unset until PLAN.md Part 7 is resolved and it deploys. */
  endpoint?: string;
  fetchImpl?: typeof fetch;
}

export class SuryaOcr implements OcrProvider {
  readonly name = "surya";
  #endpoint: string | null;
  #fetch: typeof fetch;

  constructor({ endpoint, fetchImpl = fetch }: SuryaOcrOptions = {}) {
    this.#endpoint = endpoint ?? null;
    this.#fetch = fetchImpl;
  }

  async recognize(pdf: Uint8Array): Promise<string[]> {
    if (this.#endpoint === null) {
      throw new Error(
        "Surya OCR worker is not deployed — no endpoint configured. Vercel cannot " +
          "run Surya, so the worker must first be hosted as a separate Python " +
          "service or GitHub Action (PLAN.md Part 7, OCR worker hosting). Until " +
          "then, use GeminiVisionOcr or leave the document in the review queue.",
      );
    }

    const response = await this.#fetch(this.#endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/pdf" },
      // BodyInit (under this package's DOM lib) insists on a non-shared
      // buffer; OcrProvider's Uint8Array is ArrayBufferLike-backed. Our PDFs
      // come from file reads and downloads — always plain ArrayBuffers — so
      // the assertion narrows, it does not lie.
      body: pdf as Uint8Array<ArrayBuffer>,
    });
    if (!response.ok) {
      throw new Error(`Surya worker at ${this.#endpoint} returned HTTP ${response.status}`);
    }

    const payload: unknown = await response.json();
    if (!isPagesPayload(payload)) {
      throw new Error(
        `Surya worker at ${this.#endpoint} did not reply with { pages: string[] } — ` +
          "worker and client disagree on the wire contract",
      );
    }
    return payload.pages;
  }
}

function isPagesPayload(value: unknown): value is { pages: string[] } {
  if (typeof value !== "object" || value === null) return false;
  const { pages } = value as { pages?: unknown };
  return Array.isArray(pages) && pages.every((page) => typeof page === "string");
}

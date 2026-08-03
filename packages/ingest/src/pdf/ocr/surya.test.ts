import { describe, expect, it } from "vitest";
import { SuryaOcr } from "./surya.js";

const PDF = new TextEncoder().encode("%PDF-1.4 fake scanned document");
const ENDPOINT = "https://ocr.internal.example/recognize";

interface RecordedCall {
  input: unknown;
  init: RequestInit | undefined;
}

function stubFetch(status: number, body: unknown): { impl: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const impl = (async (input: unknown, init?: RequestInit) => {
    calls.push({ input, init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("SuryaOcr", () => {
  it("throws an actionable error when the worker is not deployed", async () => {
    const ocr = new SuryaOcr();

    // The message must tell the operator what to do, not just that it failed.
    await expect(ocr.recognize(PDF)).rejects.toThrow(/not deployed/);
    await expect(ocr.recognize(PDF)).rejects.toThrow(/PLAN\.md Part 7/);
  });

  it("POSTs the raw PDF to the configured endpoint and returns its pages", async () => {
    const { impl, calls } = stubFetch(200, { pages: ["page one text", "రెండవ పేజీ"] });
    const ocr = new SuryaOcr({ endpoint: ENDPOINT, fetchImpl: impl });

    const pages = await ocr.recognize(PDF);

    expect(pages).toEqual(["page one text", "రెండవ పేజీ"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe(ENDPOINT);
    expect(calls[0]?.init?.method).toBe("POST");
    // Raw-body contract: the PDF bytes themselves, labelled as such.
    expect(calls[0]?.init?.body).toBe(PDF);
    expect(calls[0]?.init?.headers).toMatchObject({ "Content-Type": "application/pdf" });
  });

  it("surfaces a worker HTTP failure", async () => {
    const { impl } = stubFetch(500, { error: "boom" });
    const ocr = new SuryaOcr({ endpoint: ENDPOINT, fetchImpl: impl });

    await expect(ocr.recognize(PDF)).rejects.toThrow(/HTTP 500/);
  });

  it("rejects a reply that breaks the wire contract", async () => {
    // A worker that answers 200 with the wrong shape is a version mismatch,
    // not a success — better to fail loudly than ingest garbage.
    for (const body of [{ text: "merged" }, { pages: [1, 2] }, "plain string"]) {
      const { impl } = stubFetch(200, body);
      const ocr = new SuryaOcr({ endpoint: ENDPOINT, fetchImpl: impl });

      await expect(ocr.recognize(PDF)).rejects.toThrow(/pages: string\[\]/);
    }
  });
});

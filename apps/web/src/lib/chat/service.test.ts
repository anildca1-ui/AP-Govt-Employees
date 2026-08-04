import type { RetrievalDb } from "@ap-emp-ai/rag";
import { describe, expect, it } from "vitest";
import {
  encodeEvent,
  InvalidQuestionError,
  MAX_QUESTION_CHARS,
  prepareChat,
  validateQuestion,
} from "./service";

const ROW = {
  chunk_id: "c1",
  document_id: "d1",
  seq: 1,
  content: "Dearness Allowance enhanced to 37.31 percent",
  page: 1,
  go_number: "G.O.Ms.No.60",
  go_type: "Ms",
  dept: "Finance",
  issue_date: "2025-10-20",
  subject: "DA",
  subject_te: "కరువు భత్యం",
  pdf_url: "https://goir.ap.gov.in/60.pdf",
  superseded_by: null,
  vector_score: 0.9,
  keyword_score: 0.4,
  score: 0.7,
};

function fakeDb(rows: unknown[] = [ROW]): RetrievalDb {
  return { rpc: () => Promise.resolve({ data: rows, error: null }) };
}

function sseFetch(text: string): typeof fetch {
  const frame = JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] });
  return (async () => new Response(`data: ${frame}\n\n`, { status: 200 })) as unknown as typeof fetch;
}

const DEPS = {
  db: fakeDb(),
  embed: async () => Array.from({ length: 1024 }, () => 0.1),
  apiKey: "key",
  fetchImpl: sseFetch("DA is 37.31% per G.O.Ms.No.60"),
};

async function drain(stream: AsyncGenerator<string>): Promise<string> {
  let out = "";
  for await (const piece of stream) out += piece;
  return out;
}

describe("prepareChat", () => {
  it("returns citations before the answer is generated", async () => {
    // The UI shows the GOs while the prose is still streaming, and they come
    // from retrieval rather than being parsed back out of the model's text.
    const { citations, retrieval } = await prepareChat(DEPS, { question: "DA ఎంత?" });

    expect(retrieval.mode).toBe("hybrid");
    expect(citations).toHaveLength(1);
    expect(citations[0]).toMatchObject({
      goNumber: "G.O.Ms.No.60",
      issueDate: "2025-10-20",
      pdfUrl: "https://goir.ap.gov.in/60.pdf",
    });
  });

  it("streams the answer text", async () => {
    const { stream } = await prepareChat(DEPS, { question: "DA ఎంత?" });
    expect(await drain(stream)).toContain("37.31%");
  });

  it("falls back to keyword-only retrieval when embedding fails", async () => {
    // A slightly worse answer beats no answer; the keyword half still finds GOs
    // by number, department and subject.
    let embeddingSeen: unknown = "unset";
    const db: RetrievalDb = {
      rpc: (_name, params) => {
        embeddingSeen = params.query_embedding;
        return Promise.resolve({ data: [ROW], error: null });
      },
    };

    const { citations } = await prepareChat(
      {
        ...DEPS,
        db,
        embed: () => {
          throw new Error("embedding provider down");
        },
      },
      { question: "gratuity rules" },
    );

    expect(embeddingSeen).toBeNull();
    expect(citations).toHaveLength(1);
  });

  it("still answers when retrieval finds nothing, so the model can say not-found", async () => {
    const { citations, retrieval } = await prepareChat(
      { ...DEPS, db: fakeDb([]) },
      { question: "what is the moon made of" },
    );

    expect(retrieval.chunks).toEqual([]);
    expect(citations).toEqual([]);
  });

  it("rejects an empty question rather than querying", async () => {
    await expect(prepareChat(DEPS, { question: "   " })).rejects.toThrow(InvalidQuestionError);
  });

  it("rejects an oversized question", async () => {
    await expect(
      prepareChat(DEPS, { question: "x".repeat(MAX_QUESTION_CHARS + 1) }),
    ).rejects.toThrow(InvalidQuestionError);
  });

  it("takes the GO-number path when the question names a GO", async () => {
    const called: string[] = [];
    const db: RetrievalDb = {
      rpc: (name) => {
        called.push(name);
        return Promise.resolve({ data: [ROW], error: null });
      },
    };

    const { retrieval } = await prepareChat({ ...DEPS, db }, { question: "G.O.Ms.No.60 details" });

    expect(retrieval.mode).toBe("go-number");
    expect(called).toEqual(["chunks_for_go_number"]);
  });
});

describe("encodeEvent", () => {
  it("emits one JSON object per line", () => {
    const line = encodeEvent({ type: "token", text: "hello" });

    expect(line.endsWith("\n")).toBe(true);
    expect(JSON.parse(line)).toEqual({ type: "token", text: "hello" });
  });

  it("escapes newlines inside a token so one event stays one line", () => {
    // A GO extract contains newlines; an unescaped one would split the event
    // and corrupt every event after it.
    const line = encodeEvent({ type: "token", text: "line one\nline two" });

    expect(line.split("\n").filter((s) => s !== "")).toHaveLength(1);
    expect(JSON.parse(line).text).toBe("line one\nline two");
  });

  it("round-trips Telugu text intact", () => {
    const line = encodeEvent({ type: "token", text: "కరువు భత్యం 37.31%" });
    expect(JSON.parse(line).text).toBe("కరువు భత్యం 37.31%");
  });
});

describe("validateQuestion", () => {
  it("returns the trimmed question", () => {
    expect(validateQuestion("  DA ఎంత?  ")).toBe("DA ఎంత?");
  });

  it("rejects empty, blank, non-string and oversized input", () => {
    for (const bad of ["", "   ", null, undefined, 42, {}, "x".repeat(MAX_QUESTION_CHARS + 1)]) {
      expect(() => validateQuestion(bad), JSON.stringify(bad)).toThrow(InvalidQuestionError);
    }
  });

  it("accepts a question exactly at the limit", () => {
    expect(validateQuestion("x".repeat(MAX_QUESTION_CHARS))).toHaveLength(MAX_QUESTION_CHARS);
  });
});

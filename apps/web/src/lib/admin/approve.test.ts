import { describe, expect, it } from "vitest";
import {
  asGoType,
  asIsoDate,
  queueRowToDocument,
  readQueueMeta,
  type QueueRow,
} from "./approve";

const SHA = "a".repeat(64);

function row(overrides: Partial<QueueRow> = {}): QueueRow {
  return {
    id: "q-1",
    source: "goir",
    raw_url: "https://goir.ap.gov.in/Documents/51.pdf",
    file_path: null,
    sha256: SHA,
    status: "pending",
    error: null,
    meta: {},
    created_at: "2026-08-03T00:00:00Z",
    ...overrides,
  };
}

describe("queueRowToDocument", () => {
  it("maps a fully-populated row, extractor fields included", () => {
    const payload = queueRowToDocument(
      row({
        meta: {
          go_number: "G.O.Ms.No.51",
          go_type: "Ms",
          dept: "Finance",
          issue_date: "2025-04-15",
          subject: "Dearness Allowance",
          subject_te: "కరవు భత్యం",
          supersedes: ["G.O.Ms.No.27"],
          confidence: 0.93,
          needs_review: false,
          review_reasons: [],
          bytes: 12345,
          is_scanned: true,
          language: "te",
        },
      }),
    );

    expect(payload).toEqual({
      go_number: "G.O.Ms.No.51",
      go_type: "Ms",
      dept: "Finance",
      issue_date: "2025-04-15",
      subject: "Dearness Allowance",
      subject_te: "కరవు భత్యం",
      pdf_url: "https://goir.ap.gov.in/Documents/51.pdf",
      source: "goir",
      sha256: SHA,
      status: "approved",
      is_scanned: true,
      language: "te",
    });
  });

  it("turns missing meta fields into nulls, not undefined or crashes", () => {
    // A bot-forwarded PDF can reach the queue with an empty meta.
    const payload = queueRowToDocument(row({ meta: {} }));

    expect(payload.go_number).toBeNull();
    expect(payload.go_type).toBeNull();
    expect(payload.dept).toBeNull();
    expect(payload.issue_date).toBeNull();
    expect(payload.subject).toBeNull();
    expect(payload.subject_te).toBeNull();
  });

  it("omits is_scanned and language when absent, so column defaults apply", () => {
    const payload = queueRowToDocument(row({ meta: {} }));

    expect("is_scanned" in payload).toBe(false);
    expect("language" in payload).toBe(false);
  });

  it("survives meta that is not an object at all", () => {
    for (const meta of [null, "text", 7, ["x"]]) {
      expect(queueRowToDocument(row({ meta })).go_number).toBeNull();
    }
  });

  it("nulls a go_type the documents check constraint would reject", () => {
    const payload = queueRowToDocument(row({ meta: { go_type: "Order" } }));
    expect(payload.go_type).toBeNull();
  });

  it("drops a date that is not strict yyyy-mm-dd", () => {
    for (const bad of ["15-04-2025", "2025/04/15", "2025-4-5", "2025-02-30", "yesterday"]) {
      expect(queueRowToDocument(row({ meta: { issue_date: bad } })).issue_date).toBeNull();
    }
    expect(queueRowToDocument(row({ meta: { issue_date: "2025-04-15" } })).issue_date).toBe(
      "2025-04-15",
    );
  });

  it("carries sha256 and source through unchanged", () => {
    const payload = queueRowToDocument(row({ source: "whatsapp" }));
    expect(payload.sha256).toBe(SHA);
    expect(payload.source).toBe("whatsapp");
  });

  it("always inserts as approved — the whole point of the action", () => {
    expect(queueRowToDocument(row()).status).toBe("approved");
  });

  it("uses raw_url as pdf_url, tolerating null", () => {
    expect(queueRowToDocument(row()).pdf_url).toBe("https://goir.ap.gov.in/Documents/51.pdf");
    expect(queueRowToDocument(row({ raw_url: null })).pdf_url).toBeNull();
  });

  it("refuses a row without sha256 — documents.sha256 is NOT NULL", () => {
    expect(() => queueRowToDocument(row({ sha256: null }))).toThrow(/sha256/);
    expect(() => queueRowToDocument(row({ sha256: "  " }))).toThrow(/sha256/);
  });
});

describe("readQueueMeta", () => {
  it("defaults extractor fields that have not been written yet", () => {
    // Between enqueue and extraction, meta has only the index-page fields.
    const meta = readQueueMeta({ go_number: "G.O.Rt.No.9", bytes: 100 });

    expect(meta.needs_review).toBe(false);
    expect(meta.review_reasons).toEqual([]);
    expect(meta.supersedes).toEqual([]);
    expect(meta.confidence).toBeNull();
    expect(meta.is_scanned).toBeNull();
    expect(meta.language).toBeNull();
  });

  it("keeps review flags and reasons when the extractor set them", () => {
    const meta = readQueueMeta({
      needs_review: true,
      review_reasons: ["confidence 0.4 below threshold", 42, ""],
    });

    expect(meta.needs_review).toBe(true);
    // Non-strings and blanks are noise, not reasons.
    expect(meta.review_reasons).toEqual(["confidence 0.4 below threshold"]);
  });

  it("treats blank strings as missing", () => {
    const meta = readQueueMeta({ go_number: "  ", subject: "" });
    expect(meta.go_number).toBeNull();
    expect(meta.subject).toBeNull();
  });
});

describe("asGoType / asIsoDate", () => {
  it("accepts exactly the four schema go_types", () => {
    for (const ok of ["Ms", "Rt", "Memo", "Circular"]) {
      expect(asGoType(ok)).toBe(ok);
    }
    for (const bad of ["ms", "MS", "Order", "", null, 5]) {
      expect(asGoType(bad)).toBeNull();
    }
  });

  it("rejects calendar-impossible dates that match the pattern", () => {
    expect(asIsoDate("2025-02-30")).toBeNull();
    expect(asIsoDate("2025-13-01")).toBeNull();
    expect(asIsoDate("2024-02-29")).toBe("2024-02-29");
  });
});

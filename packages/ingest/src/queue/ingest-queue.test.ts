import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../dedupe.js";
import type { GoIndexEntry } from "../goir/types.js";
import { IngestQueue } from "./ingest-queue.js";

const ENTRY: GoIndexEntry = {
  goNumber: "G.O.Ms.No.51",
  goType: "Ms",
  department: "Finance",
  issueDate: "2025-04-15",
  subject: "Dearness Allowance",
  pdfUrl: "https://goir.ap.gov.in/Documents/51.pdf",
};

const PDF = new TextEncoder().encode("%PDF-1.4 fake");

interface FakeState {
  documents: Set<string>;
  queue: Set<string>;
  inserted: Record<string, unknown>[];
  insertError?: { code?: string; message: string };
  lookupError?: { message: string };
  tablesQueried: string[];
}

function makeState(overrides: Partial<FakeState> = {}): FakeState {
  return {
    documents: new Set(),
    queue: new Set(),
    inserted: [],
    tablesQueried: [],
    ...overrides,
  };
}

/** Just enough of the PostgREST builder to exercise IngestQueue. */
class FakeQuery {
  #table: string;
  #state: FakeState;
  #value = "";
  #row: Record<string, unknown> = {};

  constructor(table: string, state: FakeState) {
    this.#table = table;
    this.#state = state;
    state.tablesQueried.push(table);
  }

  select(): this {
    return this;
  }

  eq(_column: string, value: string): this {
    this.#value = value;
    return this;
  }

  insert(row: Record<string, unknown>): this {
    this.#row = row;
    return this;
  }

  async maybeSingle() {
    if (this.#state.lookupError) return { data: null, error: this.#state.lookupError };
    const known = this.#table === "documents" ? this.#state.documents : this.#state.queue;
    return { data: known.has(this.#value) ? { id: "existing" } : null, error: null };
  }

  async single() {
    if (this.#state.insertError) return { data: null, error: this.#state.insertError };
    this.#state.inserted.push(this.#row);
    return { data: { id: "new-id" }, error: null };
  }
}

function makeDb(state: FakeState): SupabaseClient {
  return { from: (table: string) => new FakeQuery(table, state) } as unknown as SupabaseClient;
}

describe("IngestQueue", () => {
  it("queues a new document with the index metadata attached", async () => {
    const state = makeState();
    const outcome = await new IngestQueue(makeDb(state), "goir").enqueue({
      entry: ENTRY,
      pdf: PDF,
    });

    expect(outcome).toEqual({ status: "queued", sha256: sha256Hex(PDF), id: "new-id" });
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({
      source: "goir",
      raw_url: ENTRY.pdfUrl,
      sha256: sha256Hex(PDF),
      // Rule 6: nothing enters the corpus without review.
      status: "pending",
      meta: {
        go_number: "G.O.Ms.No.51",
        go_type: "Ms",
        dept: "Finance",
        issue_date: "2025-04-15",
        subject: "Dearness Allowance",
        bytes: PDF.byteLength,
      },
    });
  });

  it("skips a PDF already approved into the corpus", async () => {
    const state = makeState({ documents: new Set([sha256Hex(PDF)]) });
    const outcome = await new IngestQueue(makeDb(state), "goir").enqueue({
      entry: ENTRY,
      pdf: PDF,
    });

    expect(outcome).toEqual({ status: "duplicate", sha256: sha256Hex(PDF), where: "documents" });
    expect(state.inserted).toEqual([]);
  });

  it("skips a PDF already waiting in the queue", async () => {
    const state = makeState({ queue: new Set([sha256Hex(PDF)]) });
    const outcome = await new IngestQueue(makeDb(state), "goir").enqueue({
      entry: ENTRY,
      pdf: PDF,
    });

    expect(outcome).toMatchObject({ status: "duplicate", where: "ingest_queue" });
    expect(state.inserted).toEqual([]);
  });

  it("checks documents before the queue, so an approved GO short-circuits", async () => {
    const state = makeState({ documents: new Set([sha256Hex(PDF)]) });
    await new IngestQueue(makeDb(state), "goir").enqueue({ entry: ENTRY, pdf: PDF });

    expect(state.tablesQueried).toEqual(["documents"]);
  });

  it("treats a unique violation as a duplicate, not a crash", async () => {
    // Two runs can pass the existence check before either inserts; the unique
    // index added in migration 002 is what actually settles it.
    const state = makeState({
      insertError: { code: "23505", message: "duplicate key value violates unique constraint" },
    });
    const outcome = await new IngestQueue(makeDb(state), "goir").enqueue({
      entry: ENTRY,
      pdf: PDF,
    });

    expect(outcome).toMatchObject({ status: "duplicate", where: "ingest_queue" });
  });

  it("surfaces a real insert failure instead of reporting success", async () => {
    const state = makeState({ insertError: { code: "42501", message: "permission denied" } });

    await expect(
      new IngestQueue(makeDb(state), "goir").enqueue({ entry: ENTRY, pdf: PDF }),
    ).rejects.toThrow(/permission denied/);
  });

  it("surfaces a lookup failure rather than re-queueing blindly", async () => {
    const state = makeState({ lookupError: { message: "connection reset" } });

    await expect(
      new IngestQueue(makeDb(state), "goir").enqueue({ entry: ENTRY, pdf: PDF }),
    ).rejects.toThrow(/connection reset/);
  });

  it("identifies the same bytes arriving from a different source and URL", async () => {
    const state = makeState();
    const queue = new IngestQueue(makeDb(state), "goir");
    await queue.enqueue({ entry: ENTRY, pdf: PDF });

    // Same PDF forwarded to the WhatsApp bot under a different link.
    state.queue.add(sha256Hex(PDF));
    const viaWhatsApp = new IngestQueue(makeDb(state), "whatsapp");
    const outcome = await viaWhatsApp.enqueue({
      entry: { ...ENTRY, pdfUrl: "https://example.in/forwarded.pdf" },
      pdf: PDF,
    });

    expect(outcome).toMatchObject({ status: "duplicate" });
    expect(state.inserted).toHaveLength(1);
  });
});

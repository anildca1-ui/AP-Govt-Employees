import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { TextChunk } from "../pipeline/types.js";
import { CHUNK_INSERT_BATCH_SIZE, writeChunks } from "./chunks-writer.js";

type Row = Record<string, unknown>;

interface Op {
  op: "delete" | "insert";
  column?: string | undefined;
  value?: unknown;
  rowCount?: number | undefined;
}

interface FakeState {
  ops: Op[];
  insertedBatches: Row[][];
  deleteError?: { message: string };
  insertError?: { message: string };
  tablesQueried: string[];
}

function makeState(overrides: Partial<FakeState> = {}): FakeState {
  return { ops: [], insertedBatches: [], tablesQueried: [], ...overrides };
}

/**
 * Just enough of the PostgREST builder to exercise writeChunks. The real
 * builder is a thenable that executes on await, so the fake resolves its
 * recorded operation from then().
 */
class FakeQuery {
  #state: FakeState;
  #mode: "delete" | "insert" | null = null;
  #rows: Row[] = [];
  #filter: { column: string; value: unknown } | null = null;

  constructor(table: string, state: FakeState) {
    this.#state = state;
    state.tablesQueried.push(table);
  }

  delete(): this {
    this.#mode = "delete";
    return this;
  }

  insert(rows: Row[]): this {
    this.#mode = "insert";
    this.#rows = rows;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.#filter = { column, value };
    return this;
  }

  then<T>(resolve: (result: { error: { message: string } | null }) => T): Promise<T> {
    if (this.#mode === "delete") {
      this.#state.ops.push({
        op: "delete",
        column: this.#filter?.column,
        value: this.#filter?.value,
      });
      return Promise.resolve(resolve({ error: this.#state.deleteError ?? null }));
    }
    this.#state.ops.push({ op: "insert", rowCount: this.#rows.length });
    if (this.#state.insertError) {
      return Promise.resolve(resolve({ error: this.#state.insertError }));
    }
    this.#state.insertedBatches.push(this.#rows);
    return Promise.resolve(resolve({ error: null }));
  }
}

function makeDb(state: FakeState): SupabaseClient {
  return { from: (table: string) => new FakeQuery(table, state) } as unknown as SupabaseClient;
}

function makeChunks(n: number): TextChunk[] {
  return Array.from({ length: n }, (_, i) => ({
    seq: i,
    content: `[G.O.Ms.No.51 | Finance | 2025-04-15 | DA] para ${i}`,
    page: Math.floor(i / 10) + 1,
  }));
}

function makeEmbeddings(n: number): number[][] {
  return Array.from({ length: n }, (_, i) => [i, 0.5, -0.5]);
}

describe("writeChunks", () => {
  it("deletes existing chunks, then inserts in batches of 50", async () => {
    const state = makeState();
    const result = await writeChunks(makeDb(state), "doc-1", makeChunks(120), makeEmbeddings(120));

    expect(result).toEqual({ written: 120 });
    expect(state.tablesQueried.every((table) => table === "chunks")).toBe(true);
    // Idempotent re-embedding: the old pass is wiped before the new one lands.
    expect(state.ops.map((op) => op.op)).toEqual(["delete", "insert", "insert", "insert"]);
    expect(state.ops[0]).toEqual({ op: "delete", column: "document_id", value: "doc-1" });
    expect(state.ops.slice(1).map((op) => op.rowCount)).toEqual([
      CHUNK_INSERT_BATCH_SIZE,
      CHUNK_INSERT_BATCH_SIZE,
      20,
    ]);
  });

  it("writes rows in the chunks table shape with the matching embedding", async () => {
    const state = makeState();
    await writeChunks(makeDb(state), "doc-1", makeChunks(3), makeEmbeddings(3));

    expect(state.insertedBatches).toHaveLength(1);
    expect(state.insertedBatches[0]![0]).toEqual({
      document_id: "doc-1",
      seq: 0,
      content: "[G.O.Ms.No.51 | Finance | 2025-04-15 | DA] para 0",
      embedding: [0, 0.5, -0.5],
      page: 1,
    });
    expect(state.insertedBatches[0]![2]).toMatchObject({ seq: 2, embedding: [2, 0.5, -0.5] });
  });

  it("throws on a chunk/embedding count mismatch before touching the database", async () => {
    const state = makeState();

    await expect(
      writeChunks(makeDb(state), "doc-1", makeChunks(2), makeEmbeddings(1)),
    ).rejects.toThrow(/2 chunks vs 1 embeddings/);
    // Zero writes — the mismatch must not wipe the document's existing chunks.
    expect(state.ops).toEqual([]);
    expect(state.tablesQueried).toEqual([]);
  });

  it("surfaces a delete failure and attempts no inserts", async () => {
    const state = makeState({ deleteError: { message: "permission denied" } });

    await expect(
      writeChunks(makeDb(state), "doc-1", makeChunks(2), makeEmbeddings(2)),
    ).rejects.toThrow(/delete failed for document doc-1: permission denied/);
    expect(state.ops.map((op) => op.op)).toEqual(["delete"]);
    expect(state.insertedBatches).toEqual([]);
  });

  it("surfaces an insert failure with the failing row range", async () => {
    const state = makeState({ insertError: { message: "value too long" } });

    await expect(
      writeChunks(makeDb(state), "doc-1", makeChunks(120), makeEmbeddings(120)),
    ).rejects.toThrow(/insert failed for document doc-1 \(rows 0–49 of 120\): value too long/);
    // The first failure stops the run; later batches are never attempted.
    expect(state.ops.map((op) => op.op)).toEqual(["delete", "insert"]);
  });

  it("clears old chunks even when the new chunk list is empty", async () => {
    const state = makeState();
    const result = await writeChunks(makeDb(state), "doc-1", [], []);

    expect(result).toEqual({ written: 0 });
    expect(state.ops.map((op) => op.op)).toEqual(["delete"]);
  });
});

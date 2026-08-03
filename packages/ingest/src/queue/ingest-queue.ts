import type { SupabaseClient } from "@supabase/supabase-js";
import { sha256Hex } from "../dedupe.js";
import type { GoIndexEntry } from "../goir/types.js";

/**
 * Writer for `ingest_queue` — the gate every inbound document passes through
 * before an admin can approve it into the corpus (CLAUDE.md rule 6).
 *
 * Deduplication is on the SHA-256 of the PDF bytes, never the URL: the same GO
 * arrives from goir, the e-Gazette, a Telegram channel and WhatsApp forwards,
 * under different links each time.
 */

export type EnqueueOutcome =
  | { status: "queued"; sha256: string; id: string }
  | { status: "duplicate"; sha256: string; where: "documents" | "ingest_queue" };

export interface EnqueueInput {
  entry: GoIndexEntry;
  pdf: Uint8Array;
  /** Where the file was written, when the caller keeps a local copy. */
  filePath?: string;
}

export class IngestQueue {
  #db: SupabaseClient;
  #source: string;

  constructor(db: SupabaseClient, source: string) {
    this.#db = db;
    this.#source = source;
  }

  /**
   * True when these exact bytes are already known — either queued earlier or
   * already an approved document.
   */
  async findDuplicate(sha256: string): Promise<"documents" | "ingest_queue" | null> {
    const { data: doc, error: docError } = await this.#db
      .from("documents")
      .select("id")
      .eq("sha256", sha256)
      .maybeSingle();
    if (docError) throw new Error(`documents lookup failed: ${docError.message}`);
    if (doc !== null) return "documents";

    const { data: queued, error: queueError } = await this.#db
      .from("ingest_queue")
      .select("id")
      .eq("sha256", sha256)
      .maybeSingle();
    if (queueError) throw new Error(`ingest_queue lookup failed: ${queueError.message}`);
    if (queued !== null) return "ingest_queue";

    return null;
  }

  async enqueue({ entry, pdf, filePath }: EnqueueInput): Promise<EnqueueOutcome> {
    const sha256 = sha256Hex(pdf);

    const duplicate = await this.findDuplicate(sha256);
    if (duplicate !== null) return { status: "duplicate", sha256, where: duplicate };

    const { data, error } = await this.#db
      .from("ingest_queue")
      .insert({
        source: this.#source,
        raw_url: entry.pdfUrl,
        file_path: filePath ?? null,
        sha256,
        status: "pending",
        // Metadata read off the index page. The extractor in the next task
        // re-reads it from the PDF itself; this is what the reviewer sees first.
        meta: {
          go_number: entry.goNumber,
          go_type: entry.goType,
          dept: entry.department,
          issue_date: entry.issueDate,
          subject: entry.subject,
          bytes: pdf.byteLength,
        },
      })
      .select("id")
      .single();

    if (error) {
      // Another run may have inserted the same bytes between our check and this
      // insert; the unique index is the real guard.
      if (error.code === "23505") {
        return { status: "duplicate", sha256, where: "ingest_queue" };
      }
      throw new Error(`ingest_queue insert failed: ${error.message}`);
    }

    return { status: "queued", sha256, id: data.id as string };
  }
}

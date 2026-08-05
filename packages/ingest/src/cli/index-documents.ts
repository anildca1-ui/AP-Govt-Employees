/**
 * Makes every approved Government Order searchable, in bulk.
 *
 *     pnpm --filter @ap-emp-ai/ingest index:documents
 *
 * Approving a GO puts it in the library; this is what lets the chat find it.
 * The two are separate because embedding costs money per document and takes
 * seconds, which does not belong inside a form an administrator is waiting on.
 *
 * Safe to re-run at any time. It looks for approved documents that have no
 * chunks, so anything already indexed is skipped and a crash halfway through
 * costs nothing — run it again and it picks up where it stopped.
 */

import { readFile } from "node:fs/promises";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { findUnindexedDocuments, indexDocument } from "../pipeline/index-document.js";
import { createEmbeddingProvider } from "../embed/provider.js";
import { diagnose, reportFailure } from "./diagnose.js";

const BATCH_LIMIT = Number(process.env.INDEX_BATCH_LIMIT ?? 500);

try {
  process.exitCode = await main();
} catch (error) {
  process.exitCode = reportFailure(
    diagnose(error, { url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", userAgent: "ap-emp-ai-bot" }),
  );
  if (error instanceof Error && error.stack !== undefined) console.error(error.stack);
}

async function main(): Promise<number> {
  const url = required("NEXT_PUBLIC_SUPABASE_URL");
  const key = required("SUPABASE_SERVICE_ROLE_KEY");
  const db: SupabaseClient = createClient(url, key, { auth: { persistSession: false } });

  const embeddings = createEmbeddingProvider();
  console.log(`Embeddings: ${embeddings.name} (${embeddings.dimensions}-d)\n`);

  const documents = await findUnindexedDocuments(db, BATCH_LIMIT);
  if (documents.length === 0) {
    console.log("Every approved document is already searchable. Nothing to do.");
    return 0;
  }

  console.log(`${documents.length} approved document(s) are not yet searchable.\n`);

  const counts = { indexed: 0, chunks: 0, needsOcr: 0, empty: 0, missing: 0, failed: 0 };

  for (const [position, document] of documents.entries()) {
    const label = document.go_number ?? document.id.slice(0, 8);
    const progress = `[${position + 1}/${documents.length}]`;

    try {
      const pdf = await loadPdf(db, document.id);
      if (pdf === null) {
        counts.missing += 1;
        console.log(`${progress} ${label}: PDF file not found on disk — skipped`);
        continue;
      }

      const result = await indexDocument({
        db,
        document,
        pdf,
        embeddings,
        log: (message) => console.log(message),
      });

      if (result.status === "indexed") {
        counts.indexed += 1;
        counts.chunks += result.chunks;
        console.log(`${progress} ${label}: ${result.chunks} chunk(s)`);
      } else if (result.status === "needs-ocr") {
        counts.needsOcr += 1;
        console.log(`${progress} ${label}: scanned, needs OCR — skipped`);
      } else {
        counts.empty += 1;
        console.log(`${progress} ${label}: no text found — skipped`);
      }
    } catch (error) {
      // One bad PDF must not end the run: the other four hundred still need
      // indexing, and the failure is reported at the end rather than swallowed.
      counts.failed += 1;
      console.log(
        `${progress} ${label}: failed — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  console.log(
    `\nIndexed ${counts.indexed} document(s) into ${counts.chunks} searchable chunk(s).`,
  );
  if (counts.needsOcr > 0) {
    console.log(
      `${counts.needsOcr} were scans with no text layer. They stay in the library but the ` +
        `chat cannot quote them until OCR is configured.`,
    );
  }
  if (counts.missing > 0) {
    console.log(`${counts.missing} had no PDF on disk — re-run the collector to fetch them.`);
  }
  if (counts.empty > 0) console.log(`${counts.empty} produced no text and were skipped.`);
  if (counts.failed > 0) {
    console.log(`${counts.failed} failed. Re-running is safe and will retry only those.`);
  }

  // A partial run is still progress; only a run that indexed nothing at all
  // while having work to do is a failure worth a non-zero exit.
  return counts.indexed === 0 && counts.failed > 0 ? 1 : 0;
}

/**
 * The PDF bytes for a document.
 *
 * `documents` carries the sha256 but not the file; the queue row that produced
 * it carries the local path. They are joined on the hash, which is the identity
 * of the document throughout this system.
 */
async function loadPdf(db: SupabaseClient, documentId: string): Promise<Uint8Array | null> {
  const { data: document, error } = await db
    .from("documents")
    .select("sha256")
    .eq("id", documentId)
    .maybeSingle();
  if (error !== null) throw new Error(`documents read failed: ${error.message}`);
  if (document === null) return null;

  const { data: queued, error: queueError } = await db
    .from("ingest_queue")
    .select("file_path")
    .eq("sha256", document.sha256)
    .not("file_path", "is", null)
    .maybeSingle();
  if (queueError !== null) throw new Error(`ingest_queue read failed: ${queueError.message}`);
  if (queued === null || queued.file_path === null) return null;

  try {
    return new Uint8Array(await readFile(queued.file_path));
  } catch {
    return null;
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `${name} is not set. It is needed to reach the database — see SETUP.md step 2.`,
    );
  }
  return value;
}

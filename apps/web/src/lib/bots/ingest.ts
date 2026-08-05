import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * PDF intake from the bots (PLAN.md Part 2.1).
 *
 * "This turns your audience into the ingestion network — better than scraping."
 * A GO forwarded by an employee often arrives before it reaches the goir index,
 * so the bots accept documents as well as answering questions.
 *
 * What arrives goes into ingest_queue as pending, exactly like a scraped
 * document, and reaches the corpus only after an admin approves it
 * (CLAUDE.md rule 6). Nothing a stranger sends a bot is trusted.
 */

/** Bigger than any real GO; a larger upload is a mistake or an attack. */
export const MAX_PDF_BYTES = 25 * 1024 * 1024;

export interface ForwardedDocument {
  bytes: Uint8Array;
  fileName: string | null;
  mimeType: string | null;
  /** Chat-platform identifier of the sender, for provenance only. */
  from: string;
  source: string;
}

export type IntakeOutcome =
  | { status: "queued"; sha256: string }
  | { status: "duplicate"; sha256: string }
  | { status: "rejected"; reason: string };

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** A PDF starts with %PDF-; trusting the sender's content-type is not enough. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  if (bytes.length < 5) return false;
  return (
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46 && // F
    bytes[4] === 0x2d //   -
  );
}

export async function intakeForwardedPdf(
  db: SupabaseClient,
  doc: ForwardedDocument,
): Promise<IntakeOutcome> {
  if (doc.bytes.length === 0) return { status: "rejected", reason: "The file was empty." };
  if (doc.bytes.length > MAX_PDF_BYTES) {
    return { status: "rejected", reason: "That file is too large to accept." };
  }
  // Checked on the bytes, not the declared type: a sender can claim anything.
  if (!looksLikePdf(doc.bytes)) {
    return { status: "rejected", reason: "Only PDF files can be added to the library." };
  }

  const sha256 = sha256Hex(doc.bytes);

  const { data: existingDoc } = await db
    .from("documents")
    .select("id")
    .eq("sha256", sha256)
    .maybeSingle();
  if (existingDoc !== null) return { status: "duplicate", sha256 };

  const { error } = await db.from("ingest_queue").insert({
    source: doc.source,
    raw_url: null,
    sha256,
    status: "pending",
    meta: {
      file_name: doc.fileName,
      declared_mime: doc.mimeType,
      // Kept so a reviewer can weigh who sent it; never shown publicly.
      forwarded_by: doc.from,
      bytes: doc.bytes.byteLength,
      // A stranger's forward is the least trustworthy input this system takes:
      // anyone can send anything. Without this flag the review queue renders it
      // identically to a document the scraper pulled from goir.ap.gov.in and the
      // extractor read confidently, so the warning below would sit in the data
      // exactly where the reviewer cannot see it.
      needs_review: true,
      review_reasons: ["forwarded by a member of the public, source unverified"],
      note: "Forwarded to a bot by a member of the public — verify against the official source before approving.",
    },
  });

  if (error) {
    // The partial unique index on sha256 (migration 002) is the real guard
    // against the same PDF being forwarded by twenty people at once.
    if (error.code === "23505") return { status: "duplicate", sha256 };
    throw new Error(`ingest_queue insert failed: ${error.message}`);
  }

  return { status: "queued", sha256 };
}

/** What the sender is told. Warm, and honest that a human decides. */
export function intakeReply(outcome: IntakeOutcome): string {
  switch (outcome.status) {
    case "queued":
      return "🙏 Thank you — the document has been received and is queued for review. It will appear in the library once an administrator approves it.";
    case "duplicate":
      return "🙏 Thank you — we already have this document in the library.";
    case "rejected":
      return `Sorry — ${outcome.reason}`;
  }
}

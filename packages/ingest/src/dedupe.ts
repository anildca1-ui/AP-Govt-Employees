import { createHash } from "node:crypto";

/**
 * Content hash for ingest dedupe (CLAUDE.md hard rule 3).
 *
 * The same GO reaches us from several sources — goir.ap.gov.in, the e-Gazette,
 * a Telegram channel, a WhatsApp forward — so identity is the bytes of the PDF,
 * never the URL or the filename. This value is what lands in
 * `documents.sha256` (unique) and `ingest_queue.sha256`.
 */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

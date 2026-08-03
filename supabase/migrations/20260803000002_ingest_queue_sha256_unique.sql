-- Migration 002 — make ingest_queue.sha256 unique.
--
-- Migration 001 gave ingest_queue.sha256 a plain index, which makes the
-- "have we seen this PDF?" lookup fast but does not stop a second copy landing.
-- CLAUDE.md rule 3 requires skipping duplicates, and an application-level check
-- alone loses the race: two nightly runs, or a scraper and a WhatsApp forward
-- arriving together, can both read "not present" before either inserts.
--
-- Partial, because sha256 is null until the file has actually been fetched —
-- several rows may legitimately be awaiting download at once.

drop index if exists ingest_queue_sha256_idx;

create unique index ingest_queue_sha256_key
  on ingest_queue (sha256)
  where sha256 is not null;

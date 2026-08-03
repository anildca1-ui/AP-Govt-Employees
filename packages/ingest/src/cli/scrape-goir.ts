/**
 * Nightly goir.ap.gov.in crawl.
 *
 *     pnpm --filter @ap-emp-ai/ingest scrape:goir [days]
 *
 * Downloads every GO issued in the window and puts it in `ingest_queue` for
 * admin review. Nothing reaches the corpus without that review (CLAUDE.md
 * rule 6).
 */

import { createClient } from "@supabase/supabase-js";
import { loadScraperConfig, loadSupabaseConfig } from "../config.js";
import { scrapeGoir } from "../goir/scrape.js";
import { IngestQueue } from "../queue/ingest-queue.js";

const days = Number(process.argv[2] ?? 30);
if (!Number.isFinite(days) || days < 1) {
  console.error(`Invalid window: ${process.argv[2]}`);
  process.exit(2);
}

const config = loadScraperConfig();
const supabase = loadSupabaseConfig();

const db = createClient(supabase.url, supabase.serviceRoleKey, {
  auth: { persistSession: false },
});

const summary = await scrapeGoir({
  config,
  queue: new IngestQueue(db, "goir"),
  days,
  log: (message) => console.log(message),
});

console.log("\n" + "─".repeat(60));
console.log(`rows seen         ${summary.rowsSeen}`);
console.log(`in ${days}-day window   ${summary.entriesInWindow}`);
console.log(`queued            ${summary.queued}`);
console.log(`duplicates        ${summary.duplicates}`);
console.log(`skipped           ${summary.skipped}`);
console.log(`errors            ${summary.errors.length}`);

for (const { url, message } of summary.errors) console.error(`  ${url}: ${message}`);

// A run where every document failed should not look like a success to cron.
if (summary.errors.length > 0 && summary.queued === 0) process.exitCode = 1;

/**
 * Nightly AP Finance circulars crawl.
 *
 *     pnpm --filter @ap-emp-ai/ingest scrape:finance [days]
 *
 * Queues every order in the window for admin review; nothing reaches the corpus
 * without that review (CLAUDE.md rule 6).
 */

import { createClient } from "@supabase/supabase-js";
import { loadScraperConfig, loadSupabaseConfig } from "../config.js";
import { scrapeFinance } from "../finance/scrape.js";
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

const summary = await scrapeFinance({
  config,
  queue: new IngestQueue(db, "ap-finance"),
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

// A run where everything failed must not look green to cron.
if (summary.errors.length > 0 && summary.queued === 0) process.exitCode = 1;

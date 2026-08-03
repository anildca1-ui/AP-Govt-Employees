/**
 * Nightly reference-site discovery diff.
 *
 *     pnpm --filter @ap-emp-ai/ingest watch:diff
 *
 * Diffs the six reference sites' sitemaps/feeds and queues newly-seen URLs as
 * leads. A lead is not a document: it says "someone published something new,
 * go find the official PDF" (PLAN.md Part 2.1).
 */

import { createClient } from "@supabase/supabase-js";
import { loadScraperConfig, loadSupabaseConfig } from "../config.js";
import { runWatch } from "../watch/watcher.js";

const config = loadScraperConfig();
const supabase = loadSupabaseConfig();
const db = createClient(supabase.url, supabase.serviceRoleKey, {
  auth: { persistSession: false },
});

const summaries = await runWatch({ db, config, log: (message) => console.log(message) });

console.log("\n" + "─".repeat(70));
console.log("site                entries    new  queued  note");
for (const s of summaries) {
  console.log(
    `${s.site.padEnd(20)}${String(s.entriesSeen).padStart(7)}${String(s.newUrls).padStart(7)}` +
      `${String(s.queued).padStart(8)}  ${s.skipped ?? ""}`,
  );
}

const queued = summaries.reduce((total, s) => total + s.queued, 0);
const reachable = summaries.filter((s) => s.skipped === null).length;
console.log(`\n${queued} lead(s) queued from ${reachable}/${summaries.length} site(s)`);

// Every site failing means a systemic problem — a bad UA, no network, a wrong
// key — not six coincidences. That should page cron; one site being down is
// business as usual and stays green.
if (reachable === 0) process.exitCode = 1;

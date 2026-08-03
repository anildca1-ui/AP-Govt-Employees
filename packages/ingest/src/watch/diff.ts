import type { SupabaseClient } from "@supabase/supabase-js";
import type { FeedEntry } from "./feed-parse.js";

/**
 * The diff half of the discovery watcher: which of these URLs have we not seen
 * on this site before?
 *
 * Without this, every nightly run would re-queue a site's entire sitemap. The
 * (site, url) primary key on watch_seen is what makes a second run a no-op.
 */

/** PostgREST puts the filter in the URL, so an unbounded .in() list 414s. */
export const SEEN_LOOKUP_BATCH_SIZE = 200;

export async function diffAgainstSeen(
  db: SupabaseClient,
  site: string,
  entries: FeedEntry[],
): Promise<FeedEntry[]> {
  if (entries.length === 0) return [];

  // Deduplicate within the feed itself before asking the database.
  const byUrl = new Map<string, FeedEntry>();
  for (const item of entries) if (!byUrl.has(item.url)) byUrl.set(item.url, item);
  const urls = [...byUrl.keys()];

  const seen = new Set<string>();
  for (let start = 0; start < urls.length; start += SEEN_LOOKUP_BATCH_SIZE) {
    const batch = urls.slice(start, start + SEEN_LOOKUP_BATCH_SIZE);
    const { data, error } = await db
      .from("watch_seen")
      .select("url")
      .eq("site", site)
      .in("url", batch);
    if (error) throw new Error(`watch_seen lookup failed for ${site}: ${error.message}`);
    for (const row of (data ?? []) as { url: string }[]) seen.add(row.url);
  }

  const fresh = urls.filter((url) => !seen.has(url)).map((url) => byUrl.get(url)!);
  if (fresh.length === 0) return [];

  // Recorded before the caller queues anything: a crash mid-queue should cost
  // us a discovery, not produce a run that re-queues the same URLs nightly.
  const { error: insertError } = await db
    .from("watch_seen")
    .upsert(
      fresh.map((item) => ({ site, url: item.url })),
      { onConflict: "site,url", ignoreDuplicates: true },
    );
  if (insertError) throw new Error(`watch_seen insert failed for ${site}: ${insertError.message}`);

  return fresh;
}

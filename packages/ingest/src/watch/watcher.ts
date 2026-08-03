import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScraperConfig } from "../config.js";
import { RateLimiter } from "../politeness/rate-limiter.js";
import { RobotsGate } from "../politeness/robots.js";
import { diffAgainstSeen } from "./diff.js";
import { parseFeed } from "./feed-parse.js";
import { WATCHED_SITES, type WatchedSite } from "./sites.js";

/**
 * Discovery watcher (PLAN.md Part 2.1): diff the six reference sites' feeds and
 * queue the newly-seen URLs as leads.
 *
 * What lands in ingest_queue is explicitly NOT a document. It is a note saying
 * "these people published something new — go find the official PDF". Their
 * pages are never ingested and never cited; the citation has to point at a
 * government source. That distinction is carried in the queued row's meta so a
 * reviewer opening it cannot mistake it for a GO.
 */

/** ingest_queue.source prefix, e.g. "discovery:apemp". */
export const DISCOVERY_SOURCE_PREFIX = "discovery";

export interface WatchSummary {
  site: string;
  feedUrl: string | null;
  entriesSeen: number;
  newUrls: number;
  queued: number;
  skipped: string | null;
}

export interface RunWatchOptions {
  db: SupabaseClient;
  config: ScraperConfig;
  sites?: WatchedSite[];
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
  /** Guards against a site publishing a 50k-URL sitemap in one night. */
  maxPerSite?: number;
}

export async function runWatch(options: RunWatchOptions): Promise<WatchSummary[]> {
  const {
    db,
    config,
    sites = WATCHED_SITES,
    fetchImpl = fetch,
    log = () => {},
    maxPerSite = 200,
  } = options;

  const summaries: WatchSummary[] = [];

  for (const site of sites) {
    const summary: WatchSummary = {
      site: site.id,
      feedUrl: null,
      entriesSeen: 0,
      newUrls: 0,
      queued: 0,
      skipped: null,
    };

    try {
      const robots = new RobotsGate({
        origin: site.origin,
        contactEmail: config.contactEmail,
        fetchImpl,
      });
      await robots.load();

      // Per-site limiter, built after robots.txt so a site asking for a longer
      // Crawl-delay than our floor gets it. It is per-host on purpose: the floor
      // is a per-server courtesy and these are six unrelated servers, so one
      // shared limiter would make the run six times slower for nobody's benefit.
      const crawlDelay = robots.crawlDelayMs();
      const limiter = new RateLimiter({
        minDelayMs: Math.max(config.minDelayMs, crawlDelay ?? 0),
      });

      let entries: ReturnType<typeof parseFeed> = [];
      for (const feedUrl of site.feeds) {
        if (!robots.isAllowed(feedUrl)) {
          log(`[${site.id}] robots.txt disallows ${feedUrl}`);
          continue;
        }
        await limiter.acquire();
        const response = await fetchImpl(feedUrl, {
          headers: { "User-Agent": config.userAgent, Accept: "application/xml, text/xml, */*" },
        });
        if (!response.ok) {
          log(`[${site.id}] ${feedUrl} → HTTP ${response.status}`);
          continue;
        }
        entries = parseFeed(await response.text());
        if (entries.length > 0) {
          summary.feedUrl = feedUrl;
          break;
        }
      }

      summary.entriesSeen = entries.length;
      if (entries.length === 0) {
        summary.skipped = "no usable feed";
        log(`[${site.id}] no usable feed`);
        summaries.push(summary);
        continue;
      }

      const fresh = (await diffAgainstSeen(db, site.id, entries)).slice(0, maxPerSite);
      summary.newUrls = fresh.length;

      for (const item of fresh) {
        const { error } = await db.from("ingest_queue").insert({
          source: `${DISCOVERY_SOURCE_PREFIX}:${site.id}`,
          raw_url: item.url,
          status: "pending",
          meta: {
            note:
              "Discovered via sitemap/RSS diff. Locate and fetch the official PDF from " +
              "goir.ap.gov.in or the e-Gazette — do not ingest the reference site's page.",
            discovered_lastmod: item.lastmod ?? null,
            discovered_from: site.origin,
          },
        });
        // sha256 is null on a lead, so nothing here can trip the dedupe index;
        // a failed insert is a real error and worth surfacing per row.
        if (error) throw new Error(`ingest_queue insert failed for ${item.url}: ${error.message}`);
        summary.queued += 1;
      }

      log(`[${site.id}] ${entries.length} entries, ${summary.queued} new lead(s) queued`);
    } catch (error) {
      // One unreachable site must not end the run for the other five.
      summary.skipped = error instanceof Error ? error.message : String(error);
      log(`[${site.id}] skipped: ${summary.skipped}`);
    }

    summaries.push(summary);
  }

  return summaries;
}

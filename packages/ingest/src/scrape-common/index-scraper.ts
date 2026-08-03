import { chromium, type Browser } from "playwright";
import type { ScraperConfig } from "../config.js";
import { extractRows } from "../goir/scrape.js";
import { parseIndexRows } from "../goir/parse.js";
import type { GoirSelectors } from "../goir/selectors.js";
import type { GoIndexEntry } from "../goir/types.js";
import { RateLimiter } from "../politeness/rate-limiter.js";
import { RobotsGate } from "../politeness/robots.js";
import type { IngestQueue } from "../queue/ingest-queue.js";

/**
 * The goir crawl generalised so the e-Gazette and Finance-circular sources get
 * identical politeness rather than three near-copies that drift apart.
 *
 * All three sources publish the same thing — a dated index of orders linking to
 * PDFs — so only the base URL, the `source` label and the DOM selectors differ.
 * goir/scrape.ts is deliberately left untouched: it is committed and verified,
 * and rewriting it to route through here would put a working crawler at risk
 * for no behavioural gain. It should be collapsed into this once the selectors
 * for all three have been confirmed against the live sites.
 *
 * Politeness (CLAUDE.md rule 3) is structural, exactly as in scrapeGoir:
 *   - robots.txt is read first, and an unreadable one aborts rather than being
 *     treated as consent;
 *   - one shared rate limiter covers the index page and every PDF, so the floor
 *     holds across the whole run rather than per-resource-type;
 *   - a site asking for a longer Crawl-delay than our floor gets it.
 */

export interface ScrapeIndexOptions {
  /** Value written to ingest_queue.source, e.g. "e-gazette". */
  source: string;
  indexUrl: string;
  selectors: GoirSelectors;
  config: ScraperConfig;
  queue: IngestQueue;
  days?: number;
  maxDocuments?: number;
  today?: Date;
  log?: (message: string) => void;
}

export interface ScrapeSummary {
  rowsSeen: number;
  entriesInWindow: number;
  queued: number;
  duplicates: number;
  skipped: number;
  errors: { url: string; message: string }[];
}

export async function scrapeIndex(options: ScrapeIndexOptions): Promise<ScrapeSummary> {
  const {
    source,
    indexUrl,
    selectors,
    config,
    queue,
    days = 30,
    maxDocuments = 500,
    today = new Date(),
    log = () => {},
  } = options;

  const summary: ScrapeSummary = {
    rowsSeen: 0,
    entriesInWindow: 0,
    queued: 0,
    duplicates: 0,
    skipped: 0,
    errors: [],
  };

  const robots = new RobotsGate({ origin: indexUrl, contactEmail: config.contactEmail });
  await robots.load();

  if (!robots.isAllowed(indexUrl)) {
    throw new Error(`robots.txt disallows ${indexUrl} — nothing to do.`);
  }

  const crawlDelay = robots.crawlDelayMs();
  const delayMs = Math.max(config.minDelayMs, crawlDelay ?? 0);
  if (crawlDelay !== null && crawlDelay > config.minDelayMs) {
    log(`[${source}] robots.txt asks for ${crawlDelay}ms between requests; using that.`);
  }
  const limiter = new RateLimiter({ minDelayMs: delayMs });

  const browser: Browser = await chromium.launch();
  try {
    const context = await browser.newContext({ userAgent: config.userAgent });
    const page = await context.newPage();

    await limiter.acquire();
    await page.goto(indexUrl, { waitUntil: "domcontentloaded" });

    const rows = await extractRows(page, selectors);
    summary.rowsSeen = rows.length;
    log(`[${source}] index: ${rows.length} rows`);

    const { entries, skipped } = parseIndexRows(rows, { baseUrl: indexUrl, days, today });
    summary.entriesInWindow = entries.length;
    summary.skipped = skipped.length;
    for (const { reason } of skipped.slice(0, 10)) log(`[${source}] skipped: ${reason}`);

    const selected = entries.slice(0, maxDocuments);
    if (entries.length > selected.length) {
      // A silent cap reads as "that was everything" the next morning.
      log(
        `[${source}] capped at ${maxDocuments} documents; ${entries.length - selected.length} ` +
          `in-window rows were left for the next run.`,
      );
    }

    for (const entry of selected) {
      try {
        await fetchAndQueue({ entry, context, limiter, robots, queue, summary, source, log });
      } catch (error) {
        summary.errors.push({
          url: entry.pdfUrl,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await context.close();
  } finally {
    await browser.close();
  }

  return summary;
}

async function fetchAndQueue({
  entry,
  context,
  limiter,
  robots,
  queue,
  summary,
  source,
  log,
}: {
  entry: GoIndexEntry;
  context: Awaited<ReturnType<Browser["newContext"]>>;
  limiter: RateLimiter;
  robots: RobotsGate;
  queue: IngestQueue;
  summary: ScrapeSummary;
  source: string;
  log: (message: string) => void;
}): Promise<void> {
  if (!robots.isAllowed(entry.pdfUrl)) {
    summary.skipped += 1;
    log(`[${source}] robots.txt disallows ${entry.pdfUrl}`);
    return;
  }

  await limiter.acquire();
  const response = await context.request.get(entry.pdfUrl);
  if (!response.ok()) {
    throw new Error(`HTTP ${response.status()} fetching ${entry.pdfUrl}`);
  }

  const pdf = new Uint8Array(await response.body());
  const outcome = await queue.enqueue({ entry, pdf });

  if (outcome.status === "queued") {
    summary.queued += 1;
    log(`[${source}] queued ${entry.goNumber} (${outcome.sha256.slice(0, 12)}…)`);
  } else {
    summary.duplicates += 1;
    log(`[${source}] duplicate ${entry.goNumber} — already in ${outcome.where}`);
  }
}

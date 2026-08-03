import { chromium, type Browser, type Page } from "playwright";
import type { ScraperConfig } from "../config.js";
import { RateLimiter } from "../politeness/rate-limiter.js";
import { RobotsGate } from "../politeness/robots.js";
import type { IngestQueue } from "../queue/ingest-queue.js";
import { parseIndexRows } from "./parse.js";
import { defaultSelectors, GOIR_BASE_URL, type GoirSelectors } from "./selectors.js";
import type { GoIndexEntry, RawIndexRow } from "./types.js";

export interface ScrapeOptions {
  config: ScraperConfig;
  queue: IngestQueue;
  /** How far back to look. PLAN.md Phase 1 asks for the last 30 days. */
  days?: number;
  indexUrl?: string;
  selectors?: GoirSelectors;
  /** Cap on documents fetched in one run, so a bad window cannot run away. */
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

/**
 * Reads the GO index, downloads each PDF in the window, and puts it in
 * `ingest_queue` for admin review.
 *
 * Politeness (CLAUDE.md rule 3) is structural rather than advisory:
 *   - robots.txt is fetched and honoured before anything else, and an
 *     unreadable robots.txt aborts the run instead of being read as consent;
 *   - every navigation and every download goes through one shared rate limiter,
 *     so the floor holds across the index and the PDFs together;
 *   - if the site asks for a longer Crawl-delay than our floor, we take theirs.
 */
export async function scrapeGoir(options: ScrapeOptions): Promise<ScrapeSummary> {
  const {
    config,
    queue,
    days = 30,
    indexUrl = GOIR_BASE_URL,
    selectors = defaultSelectors,
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
    log(`robots.txt asks for ${crawlDelay}ms between requests; using that.`);
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
    log(`index: ${rows.length} rows`);

    const { entries, skipped } = parseIndexRows(rows, { baseUrl: indexUrl, days, today });
    summary.entriesInWindow = entries.length;
    summary.skipped = skipped.length;
    for (const { reason } of skipped.slice(0, 10)) log(`skipped: ${reason}`);

    const selected = entries.slice(0, maxDocuments);
    if (entries.length > selected.length) {
      // Never let a cap silently look like "that was everything".
      log(
        `capped at ${maxDocuments} documents; ${entries.length - selected.length} in-window rows ` +
          `were left for the next run.`,
      );
    }

    for (const entry of selected) {
      try {
        await downloadAndQueue({ entry, context, limiter, robots, queue, summary, log });
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

async function downloadAndQueue({
  entry,
  context,
  limiter,
  robots,
  queue,
  summary,
  log,
}: {
  entry: GoIndexEntry;
  context: Awaited<ReturnType<Browser["newContext"]>>;
  limiter: RateLimiter;
  robots: RobotsGate;
  queue: IngestQueue;
  summary: ScrapeSummary;
  log: (message: string) => void;
}): Promise<void> {
  if (!robots.isAllowed(entry.pdfUrl)) {
    summary.skipped += 1;
    log(`robots.txt disallows ${entry.pdfUrl}`);
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
    log(`queued ${entry.goNumber} (${outcome.sha256.slice(0, 12)}…)`);
  } else {
    summary.duplicates += 1;
    log(`duplicate ${entry.goNumber} — already in ${outcome.where}`);
  }
}

/**
 * Pulls raw cell text out of the index table. Deliberately dumb: every judgement
 * about what the strings mean lives in parse.ts, which is testable without a
 * browser.
 */
export async function extractRows(page: Page, selectors: GoirSelectors): Promise<RawIndexRow[]> {
  return page.$$eval(
    selectors.row,
    (elements, sel) => {
      const text = (root: Element, selector: string): string =>
        root.querySelector(selector)?.textContent?.trim() ?? "";

      return elements
        .map((element) => ({
          goNumber: text(element, sel.goNumber),
          department: text(element, sel.department),
          issueDate: text(element, sel.issueDate),
          subject: text(element, sel.subject),
          href: element.querySelector(sel.link)?.getAttribute("href") ?? "",
        }))
        // Header rows and spacer rows have no link.
        .filter((row) => row.href !== "");
    },
    selectors,
  );
}

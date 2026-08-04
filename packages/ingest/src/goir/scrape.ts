import { chromium, type Browser, type Page } from "playwright";
import type { ScraperConfig } from "../config.js";
import { RateLimiter } from "../politeness/rate-limiter.js";
import { RobotsGate } from "../politeness/robots.js";
import type { IngestQueue } from "../queue/ingest-queue.js";
import {
  inferColumns,
  ROW_QUALITY_FLOOR,
  rowsFromInference,
  scoreRows,
  type InferredColumns,
  type TableSnapshot,
} from "./infer.js";
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

    const { rows } = await extractRowsResilient(page, selectors, log);
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
 * Reads every table on the page into plain data, so column inference can run
 * without a browser and be tested without one.
 */
export async function snapshotTables(page: Page): Promise<TableSnapshot[]> {
  return page.$$eval("table", (tables) =>
    tables.map((table) => {
      const cellsOf = (row: Element) =>
        Array.from(row.querySelectorAll("td, th")).map((cell) => ({
          text: cell.textContent?.trim().replace(/\s+/g, " ") ?? "",
          href: cell.querySelector("a")?.getAttribute("href") ?? null,
        }));

      const explicitHeader = table.querySelector("thead tr");
      let headers = explicitHeader === null ? [] : cellsOf(explicitHeader).map((c) => c.text);

      const bodyRows = Array.from(table.querySelectorAll("tbody tr"));
      let rows = (bodyRows.length > 0 ? bodyRows : Array.from(table.querySelectorAll("tr"))).filter(
        (row) => row !== explicitHeader,
      );

      // No <thead>, but a first row of <th> is a header row by any other name.
      if (headers.length === 0 && rows.length > 0) {
        const first = rows[0];
        if (first !== undefined && first.querySelector("th") !== null && first.querySelector("td") === null) {
          headers = cellsOf(first).map((c) => c.text);
          rows = rows.slice(1);
        }
      }

      return { headers, rows: rows.map((row) => ({ cells: cellsOf(row) })) };
    }),
  );
}

export interface ExtractOutcome {
  rows: RawIndexRow[];
  /** Set when the configured selectors matched nothing and inference was used. */
  inferred: InferredColumns | null;
}

/**
 * Gets index rows, preferring the configured selectors and falling back to
 * inferring the columns from content.
 *
 * The selectors in selectors.ts were written without ever loading the page. When
 * they are wrong they match zero rows — which looks exactly like "no GOs
 * published", so a broken scraper reports a quiet, plausible nothing. The
 * fallback turns that into a working crawl, and the returned mapping tells the
 * operator which selectors to correct.
 */
export async function extractRowsResilient(
  page: Page,
  selectors: GoirSelectors,
  log: (message: string) => void = () => {},
): Promise<ExtractOutcome> {
  const direct = await extractRows(page, selectors);
  const directScore = scoreRows(direct);

  if (direct.length > 0 && directScore >= ROW_QUALITY_FLOOR) {
    return { rows: direct, inferred: null };
  }

  log(
    direct.length === 0
      ? "configured selectors matched no rows — inferring columns from the page content"
      : `configured selectors matched ${direct.length} row(s) but they do not look like GO listings ` +
        `(quality ${directScore.toFixed(2)}) — the columns are probably shifted; inferring instead`,
  );

  const tables = await snapshotTables(page);
  let best: { inferred: InferredColumns; rows: RawIndexRow[]; score: number } | null = null;

  for (const table of tables) {
    const inferred = inferColumns(table);
    const rows = rowsFromInference(table, inferred);
    if (rows.length === 0) continue;
    const score = scoreRows(rows);
    if (best === null || score > best.score) best = { inferred, rows, score };
  }

  // Never trade good rows for worse ones: if inference cannot beat what the
  // selectors produced, keep theirs and say so.
  if (best === null || best.score <= directScore) {
    if (direct.length > 0) {
      log(`inference did not improve on the configured selectors — keeping their ${direct.length} row(s)`);
      return { rows: direct, inferred: null };
    }
    log("no table on the page yielded usable rows");
    return { rows: [], inferred: null };
  }

  for (const note of best.inferred.notes) log(`  ${note}`);
  log(
    `inferred ${best.rows.length} row(s), quality ${best.score.toFixed(2)} vs ` +
      `${directScore.toFixed(2)} from the configured selectors — ` +
      `correct src/goir/selectors.ts so the fast path works next time`,
  );
  return { rows: best.rows, inferred: best.inferred };
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

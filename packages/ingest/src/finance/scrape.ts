import type { ScraperConfig } from "../config.js";
import type { IngestQueue } from "../queue/ingest-queue.js";
import { scrapeIndex, type ScrapeSummary } from "../scrape-common/index-scraper.js";
import { FINANCE_BASE_URL, FINANCE_SOURCE, financeSelectors } from "./selectors.js";

/**
 * Scraper C — AP Finance Department circulars (PLAN.md Part 2).
 *
 * Same dated-index-of-PDFs shape as goir and the e-Gazette, so the behaviour
 * lives in scrapeIndex; only the source label and selectors differ.
 */
export interface ScrapeFinanceOptions {
  config: ScraperConfig;
  queue: IngestQueue;
  days?: number;
  indexUrl?: string;
  maxDocuments?: number;
  today?: Date;
  log?: (message: string) => void;
}

export function scrapeFinance(options: ScrapeFinanceOptions): Promise<ScrapeSummary> {
  const { config, queue, days, indexUrl = FINANCE_BASE_URL, maxDocuments, today, log } = options;

  return scrapeIndex({
    source: FINANCE_SOURCE,
    indexUrl,
    selectors: financeSelectors,
    config,
    queue,
    ...(days !== undefined && { days }),
    ...(maxDocuments !== undefined && { maxDocuments }),
    ...(today !== undefined && { today }),
    ...(log !== undefined && { log }),
  });
}

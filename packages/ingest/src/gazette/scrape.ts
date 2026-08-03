import type { ScraperConfig } from "../config.js";
import type { IngestQueue } from "../queue/ingest-queue.js";
import { scrapeIndex, type ScrapeSummary } from "../scrape-common/index-scraper.js";
import { GAZETTE_BASE_URL, GAZETTE_SOURCE, gazetteSelectors } from "./selectors.js";

/**
 * Scraper B — the AP e-Gazette (PLAN.md Part 2).
 *
 * A thin wrapper: the gazette publishes the same dated-index-of-PDFs shape as
 * goir, so all the behaviour lives in scrapeIndex and only the source label and
 * selectors are specific to it.
 */
export interface ScrapeGazetteOptions {
  config: ScraperConfig;
  queue: IngestQueue;
  days?: number;
  indexUrl?: string;
  maxDocuments?: number;
  today?: Date;
  log?: (message: string) => void;
}

export function scrapeGazette(options: ScrapeGazetteOptions): Promise<ScrapeSummary> {
  const { config, queue, days, indexUrl = GAZETTE_BASE_URL, maxDocuments, today, log } = options;

  return scrapeIndex({
    source: GAZETTE_SOURCE,
    indexUrl,
    selectors: gazetteSelectors,
    config,
    queue,
    ...(days !== undefined && { days }),
    ...(maxDocuments !== undefined && { maxDocuments }),
    ...(today !== undefined && { today }),
    ...(log !== undefined && { log }),
  });
}

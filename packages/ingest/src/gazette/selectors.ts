import type { GoirSelectors } from "../goir/selectors.js";

/**
 * DOM selectors for the AP e-Gazette index (scraper B).
 *
 * ⚠️ UNVERIFIED AGAINST THE LIVE SITE — same limitation as goir/selectors.ts:
 * apegazette.cgg.gov.in is unreachable from the development sandbox (the egress
 * proxy denies it), so these describe the expected shape of a server-rendered
 * results table rather than one confirmed by looking at the page.
 *
 * Everything around them — politeness, date parsing, dedupe, queueing — is
 * tested and correct independently. Confirm these before the first real crawl:
 *
 *     pnpm --filter @ap-emp-ai/ingest verify:selectors https://apegazette.cgg.gov.in/
 */
export const GAZETTE_BASE_URL = "https://apegazette.cgg.gov.in/";

/** ingest_queue.source for everything this scraper queues. */
export const GAZETTE_SOURCE = "e-gazette";

export const gazetteSelectors: GoirSelectors = {
  row: "table tbody tr",
  goNumber: "td:nth-child(1)",
  department: "td:nth-child(2)",
  issueDate: "td:nth-child(3)",
  subject: "td:nth-child(4)",
  link: "a[href$='.pdf'], a[href*='Download'], a[href*='View']",
};

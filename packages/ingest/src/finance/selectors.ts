import type { GoirSelectors } from "../goir/selectors.js";

/**
 * DOM selectors for the AP Finance Department circulars listing (scraper C).
 *
 * ⚠️ UNVERIFIED AGAINST THE LIVE SITE — apfinance.gov.in is unreachable from the
 * development sandbox (the egress proxy denies it), so these describe the
 * expected shape of a server-rendered circulars table, not one confirmed by
 * looking at the page. Confirm before the first real crawl:
 *
 *     pnpm --filter @ap-emp-ai/ingest verify:selectors https://apfinance.gov.in/
 *
 * This source matters disproportionately: DA, HRA and PRC orders originate here,
 * and those are what the rates table and every calculator depend on.
 */
export const FINANCE_BASE_URL = "https://apfinance.gov.in/";

/** ingest_queue.source for everything this scraper queues. */
export const FINANCE_SOURCE = "ap-finance";

export const financeSelectors: GoirSelectors = {
  row: "table tbody tr",
  goNumber: "td:nth-child(1)",
  department: "td:nth-child(2)",
  issueDate: "td:nth-child(3)",
  subject: "td:nth-child(4)",
  link: "a[href$='.pdf'], a[href*='Download'], a[href*='View']",
};

/**
 * DOM selectors for the goir.ap.gov.in GO index.
 *
 * ⚠️ UNVERIFIED AGAINST THE LIVE SITE. These were written without network access
 * to goir.ap.gov.in, so they describe the expected shape of a server-rendered
 * results table, not one confirmed by looking at the page. Everything else in
 * this scraper — politeness, date handling, dedupe, queueing — is tested and
 * correct independently of them.
 *
 * They are isolated in this one file precisely so correcting them is a small,
 * contained edit. To check them against the real site:
 *
 *     pnpm --filter @ap-emp-ai/ingest verify:selectors
 *
 * which loads the index, reports what each selector matched, and prints the
 * first few rows so mismatches are obvious.
 */
export interface GoirSelectors {
  /** Rows of the results table, one GO per row. */
  row: string;
  /** Cells within a row, resolved relative to it. */
  goNumber: string;
  department: string;
  issueDate: string;
  subject: string;
  /** Anchor holding the PDF link. */
  link: string;
  /** Optional: control that advances to the next page of results. */
  nextPage?: string;
}

export const GOIR_BASE_URL = "https://goir.ap.gov.in/";

export const defaultSelectors: GoirSelectors = {
  row: "table tbody tr",
  goNumber: "td:nth-child(1)",
  department: "td:nth-child(2)",
  issueDate: "td:nth-child(3)",
  subject: "td:nth-child(4)",
  link: "a[href$='.pdf'], a[href*='Download'], a[href*='View']",
  nextPage: "a[rel='next'], .pagination a.next",
};

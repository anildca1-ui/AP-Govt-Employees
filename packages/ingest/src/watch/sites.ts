/**
 * The six reference sites this project sets out to supersede (PLAN.md codename
 * line), monitored for discovery only.
 *
 * They are watched because they are fast: an employee-run site often posts a new
 * GO the morning it is signed, before it surfaces in the goir index. What we
 * take from them is the knowledge that a GO exists — never their page content.
 * The PDF is then fetched from goir or the e-Gazette, which is both the correct
 * provenance for a citation and the reason this is defensible use of their
 * sitemaps rather than scraping their work.
 */

export interface WatchedSite {
  /** Stable key stored in watch_seen.site — do not rename without a migration. */
  id: string;
  origin: string;
  /**
   * Candidate feed URLs, tried in order until one returns usable entries. Most
   * of these run WordPress, so /sitemap.xml and /feed are the common shapes.
   */
  feeds: string[];
}

export const WATCHED_SITES: WatchedSite[] = [
  {
    id: "apemp",
    origin: "https://apemp.in",
    feeds: ["https://apemp.in/sitemap.xml", "https://apemp.in/feed"],
  },
  {
    id: "revenueacademy",
    origin: "https://revenueacademy.in",
    feeds: ["https://revenueacademy.in/sitemap.xml", "https://revenueacademy.in/feed"],
  },
  {
    id: "apgea",
    origin: "https://apgea.org",
    feeds: ["https://apgea.org/sitemap.xml", "https://apgea.org/feed"],
  },
  {
    id: "apteachers",
    origin: "https://www.apteachers.in",
    feeds: ["https://www.apteachers.in/sitemap.xml", "https://www.apteachers.in/feeds/posts/default"],
  },
  {
    id: "amaravathiteacher",
    origin: "https://amaravathiteacher.com",
    feeds: ["https://amaravathiteacher.com/sitemap.xml", "https://amaravathiteacher.com/feed"],
  },
  {
    id: "gunturbadi",
    origin: "https://gunturbadi.in",
    feeds: ["https://gunturbadi.in/sitemap.xml", "https://gunturbadi.in/feed"],
  },
];

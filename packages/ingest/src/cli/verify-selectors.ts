/**
 * Checks the goir.ap.gov.in selectors against the live site.
 *
 *     pnpm --filter @ap-emp-ai/ingest verify:selectors
 *
 * The selectors in selectors.ts were written without access to the site, so run
 * this once before the first real crawl. It loads the index exactly as the
 * scraper would — same User-Agent, same robots.txt check, same rate limit —
 * reports what each selector matched, and prints the first rows it extracted so
 * a mismatch is obvious at a glance. It downloads no PDFs and writes nothing.
 */

import { chromium } from "playwright";
import { loadScraperConfig } from "../config.js";
import { extractRows } from "../goir/scrape.js";
import { defaultSelectors, GOIR_BASE_URL } from "../goir/selectors.js";
import { parseIndexRows } from "../goir/parse.js";
import { RateLimiter } from "../politeness/rate-limiter.js";
import { RobotsGate } from "../politeness/robots.js";

const indexUrl = process.argv[2] ?? GOIR_BASE_URL;

// Throws with an actionable message if SCRAPER_CONTACT_EMAIL is unset.
const config = loadScraperConfig();
console.log(`User-Agent: ${config.userAgent}`);
console.log(`Index:      ${indexUrl}\n`);

const robots = new RobotsGate({ origin: indexUrl, contactEmail: config.contactEmail });
await robots.load();
if (!robots.isAllowed(indexUrl)) {
  console.error(`robots.txt disallows ${indexUrl}. Nothing to verify.`);
  process.exit(2);
}
const crawlDelay = robots.crawlDelayMs();
console.log(`robots.txt: allowed${crawlDelay === null ? "" : `, Crawl-delay ${crawlDelay}ms`}\n`);

const limiter = new RateLimiter({ minDelayMs: Math.max(config.minDelayMs, crawlDelay ?? 0) });
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ userAgent: config.userAgent });
  const page = await context.newPage();

  await limiter.acquire();
  await page.goto(indexUrl, { waitUntil: "domcontentloaded" });

  console.log("selector match counts");
  console.log("─".repeat(60));
  const rowCount = await page.locator(defaultSelectors.row).count();
  console.log(`  row              ${String(rowCount).padStart(4)}  ${defaultSelectors.row}`);

  for (const key of ["goNumber", "department", "issueDate", "subject", "link"] as const) {
    const selector = defaultSelectors[key];
    const count = await page.locator(`${defaultSelectors.row} ${selector}`).count();
    console.log(`  ${key.padEnd(15)} ${String(count).padStart(4)}  ${selector}`);
  }

  const rows = await extractRows(page, defaultSelectors);
  console.log(`\nextracted ${rows.length} row(s) with a link\n`);
  for (const row of rows.slice(0, 5)) console.log(row);

  const { entries, skipped } = parseIndexRows(rows, {
    baseUrl: indexUrl,
    days: 30,
    today: new Date(),
  });
  console.log(`\nparsed: ${entries.length} in the last 30 days, ${skipped.length} skipped`);
  for (const { reason } of skipped.slice(0, 5)) console.log(`  skipped: ${reason}`);

  if (rows.length === 0) {
    console.error(
      "\nNo rows matched. The selectors in src/goir/selectors.ts need correcting " +
        "against the real markup — that file is the only place they live.",
    );
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}

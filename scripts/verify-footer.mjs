/**
 * Check that every page carries the "not an official Government of AP website"
 * banner in its footer (PLAN.md Part 5, checkpoint 4), including 404s.
 *
 *   pnpm --filter @ap-emp-ai/web build
 *   pnpm --filter @ap-emp-ai/web start &
 *   pnpm verify:footer http://localhost:3000
 *
 * It reads rendered text, not HTML source. Next embeds the RSC payload in
 * <script> tags, so grepping the response body finds the banner string even on
 * a page where it never rendered — which is how a missing footer can look
 * present. Only what the browser lays out counts.
 *
 * Set CHROMIUM_PATH if Playwright's own browser download is not available.
 */
import { chromium } from "playwright";

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");

const TE = "ఇది అధికారిక ఆంధ్రప్రదేశ్ ప్రభుత్వ వెబ్‌సైట్ కాదు.";
const EN = "This is not an official Government of Andhra Pradesh website.";

// Each locale's real pages, plus the 404 shapes a stale shared link produces.
// The site is distributed by WhatsApp link, so dead links are routine, not rare.
//
// needsDb marks the pages that read Supabase. Against a server with no database
// they render the error boundary instead — which still has to carry the banner,
// so they stay in the list; only their status code is reported rather than
// failed. Everything else is a hard assertion.
const routes = [
  ...["te", "en"].flatMap((l) => [
    { path: `/${l}`, status: 200 },
    { path: `/${l}/gos`, status: 200, needsDb: true },
    { path: `/${l}/chat`, status: 200 },
    { path: `/${l}/calculators`, status: 200 },
    { path: `/${l}/calculators/da-arrears`, status: 200 },
    { path: `/${l}/news`, status: 200, needsDb: true },
    { path: `/${l}/tests`, status: 200 },
    { path: `/${l}/links`, status: 200 },
    { path: `/${l}/account`, status: 200 },
    { path: `/${l}/privacy`, status: 200 },
    { path: `/${l}/disclaimer`, status: 200 },
    { path: `/${l}/no-such-page`, status: 404 },
    { path: `/${l}/calculators/no-such-calculator`, status: 404 },
  ]),
  { path: "/totally-bogus", status: 404 },
  { path: "/te/gos/nope/deeper", status: 404 },
];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const page = await browser.newPage();
const failures = [];
const notes = [];

for (const { path, status: wantStatus, needsDb } of routes) {
  let status = 0;
  let footerText = "";
  try {
    const response = await page.goto(base + path, { waitUntil: "domcontentloaded" });
    status = response?.status() ?? 0;
    footerText = await page.locator("footer").first().innerText({ timeout: 10_000 });
  } catch (error) {
    failures.push(`${path}: ${error.message.split("\n")[0]}`);
    console.log(`✗ ${path.padEnd(38)} ${error.message.split("\n")[0]}`);
    continue;
  }

  const banner = footerText.includes(TE) || footerText.includes(EN);
  if (!banner) failures.push(`${path}: banner missing from the rendered footer`);

  // A dead URL served as 200 is a soft 404: search engines index it and keep
  // sending people there. That is always a defect. A 5xx on a page that reads
  // the database is a missing backend, which is a fact about where this is
  // running — worth printing, not worth failing.
  let statusOk = status === wantStatus;
  if (!statusOk && needsDb && status >= 500) {
    notes.push(`${path}: ${status} — database unreachable, error boundary rendered`);
    statusOk = true;
  } else if (!statusOk) {
    failures.push(`${path}: status ${status}, expected ${wantStatus}`);
  }

  console.log(
    `${banner && statusOk ? "✓" : "✗"} ${path.padEnd(38)} ${String(status).padEnd(4)}` +
      `${banner ? "banner ✓" : "BANNER MISSING"}` +
      `${status === wantStatus ? "" : ` (expected ${wantStatus})`}`,
  );
}

await browser.close();

if (notes.length > 0) {
  console.log(`\n${notes.length} route(s) fell back to the error boundary:`);
  for (const n of notes) console.log(`  · ${n}`);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} problem(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\nall ${routes.length} routes carry the banner`);

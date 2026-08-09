/**
 * Drives all thirteen calculators in a browser and checks that what they show
 * holds together.
 *
 *   pnpm --filter @ap-emp-ai/web build
 *   pnpm --filter @ap-emp-ai/web start &
 *   pnpm verify:calculators http://localhost:3000
 *
 * Two properties, both learned from real defects rather than imagined:
 *
 * 1. Every rupee figure in the WhatsApp share text must be visible on the page.
 *    The salary calculator quoted a gross that appeared nowhere on screen, so a
 *    reader forwarded a number to colleagues that they had never been shown and
 *    could not check.
 *
 * 2. The result must not be blank where the inputs were valid. A calculator
 *    that silently renders nothing is indistinguishable from a broken page.
 *
 * What it deliberately does NOT check is whether the amounts are *right* — that
 * depends on rates nobody has verified against a GO yet (TASKS.md). This checks
 * internal consistency, which is the part that can be settled without one.
 *
 * Set CHROMIUM_PATH if Playwright's own browser download is not available.
 */
import { chromium } from "playwright";

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");

/**
 * A basic pay chosen so DA-inclusive emoluments are fractional — 52,590 ×
 * 1.3731 = 72,211.329. Round figures like 100,000 hide rounding defects
 * completely, which is exactly how three of them survived in the test suite.
 *
 * The pay-scale calculators are the exception: they legitimately refuse a pay
 * that is not a stage of the master scale, so they get one that is.
 */
const AWKWARD_PAY = "52590";
const ON_SCALE_PAY = "52600";
const ON_SCALE = new Set(["increment", "fixation"]);

/** Numeric inputs that are not rupee amounts, so filling them would distort. */
const RATIO_OR_COUNT =
  /fraction|percent|pct|rate|factor|year|day|age|month|ceiling|assured|annuity|premium|min/i;

const SLUGS = [
  "da-arrears", "salary", "increment", "fixation", "nps", "gps", "ops-pension",
  "gratuity", "leave-encashment", "income-tax", "apgli-gpf", "retirement", "medical",
];

/** Wizards answer with prose, not amounts, so they have no share figures. */
const NO_AMOUNTS = new Set(["medical", "retirement"]);

const amounts = (text) => [...text.matchAll(/₹\s?([\d,]+(?:\.\d+)?)/g)].map((m) => m[1].replace(/,/g, ""));

const failures = [];
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);

for (const slug of SLUGS) {
  const page = await browser.newPage();
  try {
    await page.goto(`${base}/en/calculators/${slug}`, { waitUntil: "networkidle" });

    const fields = await page
      .locator("form input")
      .evaluateAll((els) => els.map((e) => ({ name: e.name, type: e.type })));

    const pay = ON_SCALE.has(slug) ? ON_SCALE_PAY : AWKWARD_PAY;
    for (const field of fields) {
      if (field.type !== "number") continue;
      const input = page.locator(`input[name="${field.name}"]`);

      if (/basic|pay/i.test(field.name)) {
        await input.fill(pay).catch(() => undefined);
        continue;
      }

      // Every other amount is forced non-zero, and that is the whole point
      // rather than tidiness: the salary deductions default to "0", so gross
      // equals net, so a missing gross row is invisible — this check passed a
      // build that had the defect until it filled them. Zero is not a usable
      // test value for anything that separates a subtotal from a total.
      //
      // Inputs that are not rupee amounts — fractions, percentages, counts,
      // dates — keep their defaults, since a stray 1,000 there means something
      // entirely different.
      if (RATIO_OR_COUNT.test(field.name)) continue;
      const current = await input.inputValue().catch(() => "skip");
      if (current === "" || Number(current) === 0) {
        await input.fill("1000").catch(() => undefined);
      }
    }

    await page.locator("button[type=submit]").first().click().catch(() => undefined);
    await page.waitForTimeout(700);

    const body = await page.locator("body").innerText();
    const resultAt = body.indexOf("Result");
    const shown = resultAt < 0 ? "" : body.slice(resultAt).split("Source:")[0];

    if (shown.trim() === "") {
      failures.push(`${slug}: valid inputs produced no result panel`);
      console.log(`  ✗ ${slug.padEnd(17)} no result`);
      continue;
    }

    const href = await page.locator('a[href*="wa.me"]').getAttribute("href").catch(() => null);
    const shareFigures = href === null ? [] : amounts(decodeURIComponent(href));
    const onScreen = new Set(amounts(shown));

    const missing = shareFigures.filter((figure) => !onScreen.has(figure));
    if (missing.length > 0 && !NO_AMOUNTS.has(slug)) {
      failures.push(`${slug}: share text quotes ₹${missing.join(", ₹")} which is not on the page`);
      console.log(`  ✗ ${slug.padEnd(17)} shares ₹${missing.join(", ₹")} — not shown`);
    } else {
      console.log(`  ✓ ${slug.padEnd(17)} ${shareFigures.length} shared figure(s), all on the page`);
    }
  } finally {
    await page.close();
  }
}

await browser.close();

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} calculator problem(s)\n`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("\n✓ all 13 calculators render a result, and share only what they show");

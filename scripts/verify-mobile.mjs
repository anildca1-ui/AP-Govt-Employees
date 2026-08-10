/**
 * Checks the site on a phone, which is how it is actually read.
 *
 *   pnpm --filter @ap-emp-ai/web build
 *   pnpm --filter @ap-emp-ai/web start &
 *   pnpm verify:mobile http://localhost:3000
 *
 * The portal is handed around as a WhatsApp link to government employees on
 * budget Androids, so 360 CSS px is the real target, not an edge case. Every
 * other check in this repository has run at desktop width.
 *
 * Two properties:
 *
 * 1. No page scrolls sideways. Horizontal scroll on a phone hides content
 *    with no indication that anything is missing, and it is caused by one
 *    stray wide element that is invisible at desktop width.
 *
 * 2. No tap target under 24×24 CSS px (WCAG 2.2 SC 2.5.8). The privacy and
 *    disclaimer links sat at 20px tall in the footer of every page — the two
 *    a reader is most likely to want on a phone, and the ones a DPDP notice
 *    depends on being reachable.
 *
 * Calculators are checked twice: empty, and with a result on screen. The wide
 * content — the month-by-month arrears table — only exists after submitting,
 * so checking the empty form proves nothing about the page people see.
 *
 * Set CHROMIUM_PATH if Playwright's own browser download is not available.
 */
/* global document -- the page.evaluate callback below runs inside Chromium,
   not Node; `document` is real there even though this file lints as Node. */
import { chromium } from "playwright";

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const WIDTH = 360;
const MIN_TARGET = 24;

const PAGES = [
  "/te", "/te/calculators", "/te/chat", "/te/gos", "/te/news",
  "/te/tests", "/te/links", "/te/privacy", "/te/disclaimer", "/te/account",
];

/** Calculators driven to a result, since that is when the tables appear. */
const WITH_RESULTS = [
  ["da-arrears", { basicPay: "52590", fromMonth: "2024-01", toMonth: "2025-09", paidDa: "33.67" }],
  ["salary", { basicPay: "52590", pf: "10000", apgli: "1000", gis: "120", pt: "200" }],
  ["nps", { basicPay: "52590" }],
  ["income-tax", { gross: "1200000" }],
  ["apgli-gpf", { basicPay: "52590" }],
];

const failures = [];

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const page = await browser.newPage({
  viewport: { width: WIDTH, height: 640 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});

async function inspect(label) {
  const found = await page.evaluate(
    ({ width, minTarget }) => {
      const root = document.documentElement;
      const wide = [...document.querySelectorAll("*")]
        .filter((el) => el.getBoundingClientRect().right > width + 1)
        .slice(0, 3)
        .map((el) => `<${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 40)}">`);

      const tiny = [];
      for (const el of document.querySelectorAll("a, button, select, input[type=checkbox], input[type=radio]")) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (Math.min(rect.width, rect.height) < minTarget) {
          const text = (el.innerText || el.value || el.getAttribute("aria-label") || "").trim();
          tiny.push(`"${text.slice(0, 24)}" ${Math.round(rect.width)}×${Math.round(rect.height)}`);
        }
      }
      return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth, wide, tiny };
    },
    { width: WIDTH, minTarget: MIN_TARGET },
  );

  const overflows = found.scrollWidth > found.clientWidth + 1;
  const problems = [];
  if (overflows) {
    problems.push(`scrolls sideways (${found.scrollWidth}px in a ${found.clientWidth}px viewport)`);
    if (found.wide.length > 0) problems.push(`  widest: ${found.wide.join(", ")}`);
  }
  if (found.tiny.length > 0) {
    problems.push(`${found.tiny.length} tap target(s) under ${MIN_TARGET}px: ${found.tiny.join(", ")}`);
  }

  if (problems.length > 0) {
    failures.push(`${label}: ${problems[0]}`);
    console.log(`  ✗ ${label}`);
    for (const problem of problems) console.log(`      ${problem}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

// ── Wire weight ─────────────────────────────────────────────────────────────
// The audience is on metered mobile data, so the first visit's transfer size
// is a feature. Today it is ~375 kB, half of which is the Telugu font — the
// irreducible cost of not rendering tofu on phones without a Telugu face
// (fonts ~187 kB as one variable file per script, already cheaper than static
// weights). The budget is set with headroom over today, not aspiration: it
// exists to catch a regression like an accidental second font family or a
// dependency landing in the shared bundle, not to start a diet.
const WIRE_BUDGET_KB = 450;
{
  const finished = [];
  const onFinished = async (request) => {
    try {
      finished.push((await request.sizes()).responseBodySize);
    } catch {
      // A request torn down before sizes() resolves (navigation, abort) has
      // nothing to count.
    }
  };
  page.on("requestfinished", onFinished);
  await page.goto(`${base}/te`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  page.off("requestfinished", onFinished);

  const totalKb = finished.reduce((sum, bytes) => sum + Math.max(0, bytes), 0) / 1024;
  console.log(`First visit to /te: ${totalKb.toFixed(0)} kB on the wire (budget ${WIRE_BUDGET_KB} kB)`);
  if (totalKb > WIRE_BUDGET_KB) {
    failures.push(
      `/te first visit transfers ${totalKb.toFixed(0)} kB — over the ${WIRE_BUDGET_KB} kB budget`,
    );
  }
}

console.log(`\nAt ${WIDTH}px:`);
for (const path of PAGES) {
  await page.goto(base + path, { waitUntil: "networkidle" });
  await inspect(path);
}

console.log("\nWith a result on screen:");
for (const [slug, fields] of WITH_RESULTS) {
  await page.goto(`${base}/te/calculators/${slug}`, { waitUntil: "networkidle" });
  for (const [name, value] of Object.entries(fields)) {
    await page.locator(`input[name="${name}"]`).fill(value).catch(() => undefined);
  }
  await page.locator("button[type=submit]").first().click().catch(() => undefined);
  await page.waitForTimeout(700);
  await inspect(`/te/calculators/${slug} (result)`);
}

await browser.close();

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} problem(s) on a ${WIDTH}px phone\n`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`\n✓ nothing scrolls sideways and every tap target clears ${MIN_TARGET}px at ${WIDTH}px`);

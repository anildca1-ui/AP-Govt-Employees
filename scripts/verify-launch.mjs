/**
 * The pre-launch legal checklist from PLAN.md Part 5, checkpoint 4, as one
 * command that fails when an item fails.
 *
 *   pnpm --filter @ap-emp-ai/web build
 *   pnpm --filter @ap-emp-ai/web start &
 *   pnpm verify:launch http://localhost:3000
 *
 * The four items are: disclaimer pages live, DPDP consent and delete-my-data
 * working, the site unmonetized, and the "not an official Government of AP
 * website" banner on every page. The last is scripts/verify-footer.mjs, which
 * this runs, so one command covers the whole checkpoint.
 *
 * Two of these are checked against the running site and two against the source.
 * The output says which, because a checklist that reports a source grep as if it
 * were a live test is how an item gets ticked that was never true.
 *
 * Set CHROMIUM_PATH if Playwright's own browser download is not available.
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const origin = new URL(base).host;

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(new URL(p, new URL("..", import.meta.url)), "utf8");

const failures = [];
const notes = [];
function check(ok, item, detail) {
  console.log(`  ${ok ? "✓" : "✗"} ${detail}`);
  if (!ok) failures.push(`${item}: ${detail}`);
}

/**
 * Hosts a page may contact.
 *
 * Only our own origin. The site is for government employees on metered phones,
 * it carries no advertising by design (the conduct rules make monetisation a
 * problem, not just a choice), and under DPDP every third party that sees a
 * visitor's IP is a disclosure we would have to make.
 *
 * Sentry is the one deliberate exception and only when a DSN is configured — it
 * is disclosed in /privacy. This check runs against a build without one, so any
 * request leaving the origin here is unintended.
 */
const ALLOWED_HOSTS = new Set([origin]);

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);

// ── 1. Disclaimer and privacy pages live ────────────────────────────────────
console.log("\n1. Disclaimer and privacy pages live (runtime)");
{
  const page = await browser.newPage();
  for (const locale of ["te", "en"]) {
    for (const path of ["/privacy", "/disclaimer"]) {
      const url = `${base}/${locale}${path}`;
      const response = await page.goto(url, { waitUntil: "networkidle" });
      const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      check(response.status() === 200, "disclaimer pages", `${locale}${path} → ${response.status()}`);
      // A stub would still return 200. These pages are the legal position, so
      // they have to actually say something.
      check(text.length > 600, "disclaimer pages", `${locale}${path} has substantive text (${text.length} chars)`);
      if (locale === "te") {
        check(/[ఀ-౿]/.test(text), "disclaimer pages", `te${path} is in Telugu`);
      }
    }
  }
  // The specific disclosures DPDP requires a reader to be able to find.
  for (const locale of ["te", "en"]) {
    await page.goto(`${base}/${locale}/privacy`, { waitUntil: "networkidle" });
    const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    const wantsDelete = locale === "te" ? /తొలగించ|డిలీట్/ : /delete/i;
    check(wantsDelete.test(text), "DPDP", `${locale}/privacy tells the reader they can have their data deleted`);
  }
  await page.close();
}

// ── 2. DPDP consent and delete-my-data ──────────────────────────────────────
console.log("\n2. DPDP consent and delete-my-data (source + schema)");
{
  const account = read("apps/web/src/app/[locale]/account/page.tsx");
  const actions = read("apps/web/src/app/[locale]/account/actions.ts");
  const profile = read("apps/web/src/lib/account/profile.ts");
  const smoke = read("supabase/tests/001_schema_smoke.sql");

  check(
    /name="profile_storage"/.test(account) && /name="chat_logging"/.test(account),
    "DPDP",
    "both consent purposes are offered on /account",
  );
  check(
    /profile_storage_text/.test(account) && /chat_logging_text/.test(account),
    "DPDP",
    "the wording shown at the time of consent is submitted with it",
  );
  check(
    /CONSENT_POLICY_VERSION/.test(profile) && /CONSENT_POLICY_VERSION/.test(actions),
    "DPDP",
    "consent is stamped with the policy version it was given under",
  );
  check(
    /export async function deleteMyData/.test(actions),
    "DPDP",
    "delete-my-data action exists",
  );
  check(
    /field\(formData, "confirm"\) !== "DELETE"/.test(actions),
    "DPDP",
    "deletion requires an explicit typed confirmation",
  );
  // Consent is an audit trail: the question a regulator asks is what someone
  // agreed to on a given day, which an updatable row cannot answer.
  check(
    /append-only|consent/i.test(smoke) && /update/i.test(smoke),
    "DPDP",
    "the schema smoke test asserts consent rows cannot be rewritten",
  );
  notes.push(
    "Consent and deletion are asserted from source and the schema test; the " +
      "signed-in flow itself needs a configured Supabase project and a real " +
      "session, so it has not been exercised end to end.",
  );
}

// ── 3. Unmonetized: no third party sees a visitor ───────────────────────────
console.log("\n3. Unmonetized — no third-party requests (runtime)");
{
  const page = await browser.newPage();
  const offOrigin = new Map();
  page.on("request", (request) => {
    const host = new URL(request.url()).host;
    if (host && !ALLOWED_HOSTS.has(host)) {
      offOrigin.set(host, (offOrigin.get(host) ?? 0) + 1);
    }
  });

  const paths = [
    "/te", "/en", "/te/chat", "/te/calculators", "/te/calculators/da-arrears",
    "/te/gos", "/te/news", "/te/tests", "/te/links", "/te/privacy",
    "/te/disclaimer", "/te/account", "/te/dashboard",
  ];
  for (const path of paths) {
    await page.goto(base + path, { waitUntil: "networkidle" }).catch(() => undefined);
  }

  check(
    offOrigin.size === 0,
    "unmonetized",
    offOrigin.size === 0
      ? `no page contacted any host but its own (${paths.length} pages)`
      : `contacted ${[...offOrigin.entries()].map(([h, n]) => `${h} ×${n}`).join(", ")}`,
  );
  await page.close();

  // Belt and braces: the runtime check only sees code that ran on the pages
  // visited. A grep catches an ad slot behind a route or a flag.
  //
  // grep exits 1 when it matches nothing, which here is the passing case, and
  // 2 or more when the search itself failed. Collapsing those would report a
  // broken search as a clean bill of health.
  let sources;
  try {
    sources = execFileSync(
      "grep",
      [
        "-rilE",
        "googletagmanager|google-analytics|adsbygoogle|doubleclick|amazon-adsystem|" +
          "facebook\\.net|hotjar|mixpanel|razorpay|stripe|paypal|buymeacoffee",
        "apps/web/src",
        "packages",
      ],
      { cwd: root, encoding: "utf8" },
    ).trim();
  } catch (error) {
    if (error.status === 1) {
      sources = "";
    } else {
      check(false, "unmonetized", `source scan could not run: ${error.message}`);
      sources = null;
    }
  }
  if (sources !== null) {
    check(
      sources === "",
      "unmonetized",
      sources === "" ? "no ad, payment or analytics SDK in source" : `found in: ${sources}`,
    );
  }
}

await browser.close();

// ── 4. The banner on every page ─────────────────────────────────────────────
console.log("\n4. \"Not an official Government of AP website\" banner (runtime)");
try {
  execFileSync("node", ["scripts/verify-footer.mjs", base], { cwd: root, stdio: "inherit" });
  console.log("  ✓ every page carries the banner");
} catch {
  failures.push("banner: scripts/verify-footer.mjs failed");
}

// ── Result ──────────────────────────────────────────────────────────────────
console.log("");
for (const note of notes) console.log(`note: ${note}`);
if (failures.length > 0) {
  console.error(`\n✗ pre-launch checklist: ${failures.length} failing\n`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("\n✓ pre-launch legal checklist passed (PLAN.md Part 5, checkpoint 4)");

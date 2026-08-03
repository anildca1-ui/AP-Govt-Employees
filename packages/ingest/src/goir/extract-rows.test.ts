import { existsSync } from "node:fs";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { extractRows } from "./scrape.js";
import { defaultSelectors } from "./selectors.js";

/**
 * Exercises the selector extraction against a real DOM in a real browser.
 *
 * The fixture below is a plausible server-rendered results table, NOT a capture
 * of goir.ap.gov.in — see the warning in selectors.ts. So this proves the
 * extraction mechanism works (cells map to fields, header and spacer rows are
 * dropped, relative hrefs survive); it does not prove the selectors match the
 * live site.
 */

const FIXTURE = `
<table>
  <thead>
    <tr><th>GO Number</th><th>Department</th><th>Date</th><th>Subject</th></tr>
  </thead>
  <tbody>
    <tr>
      <td>G.O.Ms.No.51</td>
      <td>Finance</td>
      <td>15/04/2025</td>
      <td>Dearness Allowance to State Government Employees</td>
      <td><a href="/Documents/51.pdf">Download</a></td>
    </tr>
    <tr>
      <td>G.O.Rt.No.1234</td>
      <td>School Education</td>
      <td>02/04/2025</td>
      <td>Transfers and postings</td>
      <td><a href="Documents/1234.pdf">Download</a></td>
    </tr>
    <tr class="spacer"><td colspan="5">&nbsp;</td></tr>
  </tbody>
</table>`;

function resolveBrowserPath(): string | undefined {
  // The sandbox ships a pinned Chromium that may not match the version this
  // Playwright build expects.
  const candidates = [
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    "/opt/pw-browsers/chromium/chrome-linux/chrome",
  ];
  return candidates.find((path) => existsSync(path));
}

async function launch(): Promise<Browser | null> {
  const executablePath = resolveBrowserPath();
  try {
    return await chromium.launch(executablePath ? { executablePath } : {});
  } catch {
    return null;
  }
}

describe("extractRows", () => {
  let browser: Browser | null = null;

  beforeAll(async () => {
    browser = await launch();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  it("maps table cells to raw rows and drops rows with no link", async ({ skip }) => {
    // No browser available (e.g. a CI runner without Playwright browsers): skip
    // rather than fail, since nothing about the code under test has changed.
    if (browser === null) skip();

    const page = await browser!.newPage();
    await page.setContent(FIXTURE);

    const rows = await extractRows(page, defaultSelectors);
    await page.close();

    expect(rows).toEqual([
      {
        goNumber: "G.O.Ms.No.51",
        department: "Finance",
        issueDate: "15/04/2025",
        subject: "Dearness Allowance to State Government Employees",
        href: "/Documents/51.pdf",
      },
      {
        goNumber: "G.O.Rt.No.1234",
        department: "School Education",
        issueDate: "02/04/2025",
        subject: "Transfers and postings",
        href: "Documents/1234.pdf",
      },
    ]);
  }, 60_000);

  it("feeds parseIndexRows cleanly, end to end", async ({ skip }) => {
    if (browser === null) skip();

    const { parseIndexRows } = await import("./parse.js");
    const page = await browser!.newPage();
    await page.setContent(FIXTURE);
    const rows = await extractRows(page, defaultSelectors);
    await page.close();

    const { entries, skipped } = parseIndexRows(rows, {
      baseUrl: "https://goir.ap.gov.in/",
      days: 30,
      today: new Date("2025-04-30T00:00:00Z"),
    });

    expect(skipped).toEqual([]);
    expect(entries.map((e) => e.pdfUrl)).toEqual([
      "https://goir.ap.gov.in/Documents/51.pdf",
      "https://goir.ap.gov.in/Documents/1234.pdf",
    ]);
    expect(entries.map((e) => e.goType)).toEqual(["Ms", "Rt"]);
  }, 60_000);
});

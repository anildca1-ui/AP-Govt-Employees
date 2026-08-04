import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * PLAN.md Part 5, checkpoint 4 requires the "not an official Government of AP
 * website" line in the footer of EVERY page. That holds today because of two
 * routing facts, neither of which is obvious from reading any single file — and
 * both of which were once wrong.
 *
 * These are structural assertions, not rendering ones. They cannot prove the
 * banner is on screen; they guard the two ways it silently disappears from a
 * whole class of pages. Re-run scripts/verify-footer.mjs against a running
 * server to check what a visitor actually sees.
 */
const appDir = fileURLToPath(new URL(".", import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

describe("the unofficial-site banner reaches every page", () => {
  const files = walk(appDir).map((f) => f.slice(appDir.length));

  it("routes all pages through the one layout that renders the footer", () => {
    // A second layout outside [locale] would render its subtree without the
    // footer, and nothing else in the codebase would say so.
    const layouts = files.filter((f) => f.endsWith("layout.tsx"));
    expect(layouts).toEqual(["[locale]/layout.tsx"]);

    const layout = readFileSync(join(appDir, "[locale]/layout.tsx"), "utf8");
    expect(layout).toContain("SiteFooter");
  });

  it("keeps a catch-all so an unmatched URL 404s inside that layout", () => {
    // Without it, Next serves its own built-in 404 for any unmatched URL: no
    // layout, so no footer and no banner — on the page a visitor following a
    // stale WhatsApp link is most likely to land on. A [locale]/not-found.tsx
    // alone does NOT cover this; that boundary is only reached when a matched
    // route calls notFound(), which is what the catch-all exists to do.
    expect(files).toContain("[locale]/[...rest]/page.tsx");
    expect(files).toContain("[locale]/not-found.tsx");

    const catchAll = readFileSync(join(appDir, "[locale]/[...rest]/page.tsx"), "utf8");
    expect(catchAll).toContain("notFound()");
  });
});

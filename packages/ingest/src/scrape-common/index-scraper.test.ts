import { describe, expect, it } from "vitest";
import type { ScraperConfig } from "../config.js";
import { GAZETTE_SOURCE, gazetteSelectors, GAZETTE_BASE_URL } from "../gazette/selectors.js";
import { FINANCE_SOURCE, financeSelectors, FINANCE_BASE_URL } from "../finance/selectors.js";
import { scrapeIndex } from "./index-scraper.js";
import type { IngestQueue } from "../queue/ingest-queue.js";

/**
 * The behaviour that matters here is the politeness contract (CLAUDE.md rule 3),
 * which must hold before a browser is ever launched. These assert the aborts
 * that happen during robots.txt handling — the paths that decide whether we
 * touch a government server at all.
 *
 * The DOM extraction shared with goir is covered by goir/extract-rows.test.ts,
 * and the date/window/dedupe logic by goir/parse.test.ts and the queue tests.
 */

const CONFIG: ScraperConfig = {
  contactEmail: "admin@ap-emp-ai.in",
  userAgent: "ap-emp-ai-bot (contact: admin@ap-emp-ai.in)",
  minDelayMs: 2000,
  downloadDir: ".downloads",
};

/** Never reached in these tests — robots aborts first. */
const QUEUE = {} as IngestQueue;

function withFetch(impl: typeof fetch): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return () => {
    globalThis.fetch = original;
  };
}

function robotsReply(status: number, body: string): typeof fetch {
  return (async () => new Response(body, { status })) as typeof fetch;
}

describe("scrapeIndex politeness", () => {
  it("aborts when robots.txt cannot be read, rather than assuming consent", async () => {
    const restore = withFetch(robotsReply(503, "unavailable"));
    try {
      await expect(
        scrapeIndex({
          source: GAZETTE_SOURCE,
          indexUrl: GAZETTE_BASE_URL,
          selectors: gazetteSelectors,
          config: CONFIG,
          queue: QUEUE,
        }),
      ).rejects.toThrow(/Refusing to crawl/);
    } finally {
      restore();
    }
  });

  it("refuses to crawl an index robots.txt disallows", async () => {
    const restore = withFetch(robotsReply(200, "User-agent: *\nDisallow: /\n"));
    try {
      await expect(
        scrapeIndex({
          source: FINANCE_SOURCE,
          indexUrl: FINANCE_BASE_URL,
          selectors: financeSelectors,
          config: CONFIG,
          queue: QUEUE,
        }),
      ).rejects.toThrow(/robots\.txt disallows/);
    } finally {
      restore();
    }
  });

  it("honours a rule aimed at our product token specifically", async () => {
    // The group names the bare token, not the full User-Agent header — the
    // distinction that RobotsGate exists to get right.
    const restore = withFetch(
      robotsReply(200, "User-agent: *\nDisallow:\n\nUser-agent: ap-emp-ai-bot\nDisallow: /\n"),
    );
    try {
      await expect(
        scrapeIndex({
          source: GAZETTE_SOURCE,
          indexUrl: GAZETTE_BASE_URL,
          selectors: gazetteSelectors,
          config: CONFIG,
          queue: QUEUE,
        }),
      ).rejects.toThrow(/robots\.txt disallows/);
    } finally {
      restore();
    }
  });

  it("refuses to build a User-Agent from a placeholder contact address", async () => {
    // No fetch stub: this must fail before any request is made.
    await expect(
      scrapeIndex({
        source: GAZETTE_SOURCE,
        indexUrl: GAZETTE_BASE_URL,
        selectors: gazetteSelectors,
        config: { ...CONFIG, contactEmail: "someone@example.com" },
        queue: QUEUE,
      }),
    ).rejects.toThrow(/SCRAPER_CONTACT_EMAIL/);
  });
});

describe("source labelling", () => {
  it("keeps the two new sources distinct from goir in ingest_queue", () => {
    // ingest_queue.source is how a reviewer knows where a document came from,
    // and how a bad source can be re-run in isolation.
    expect(new Set([GAZETTE_SOURCE, FINANCE_SOURCE, "goir"]).size).toBe(3);
  });
});

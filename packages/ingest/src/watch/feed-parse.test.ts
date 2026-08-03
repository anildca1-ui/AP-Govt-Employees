import { describe, expect, it } from "vitest";
import { isSitemapIndex, parseFeed } from "./feed-parse.js";

describe("parseFeed", () => {
  it("reads a sitemap urlset with lastmod", () => {
    const xml = `<?xml version="1.0"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://apemp.in/go-51</loc><lastmod>2025-04-15</lastmod></url>
        <url><loc>https://apemp.in/go-52</loc></url>
      </urlset>`;

    expect(parseFeed(xml)).toEqual([
      { url: "https://apemp.in/go-51", lastmod: "2025-04-15" },
      { url: "https://apemp.in/go-52" },
    ]);
  });

  it("collapses a single-entry sitemap correctly", () => {
    // fast-xml-parser gives a bare object rather than a one-element array here,
    // which is the classic way a feed parser silently returns nothing.
    const xml = `<urlset><url><loc>https://apemp.in/only</loc></url></urlset>`;
    expect(parseFeed(xml)).toEqual([{ url: "https://apemp.in/only" }]);
  });

  it("returns the child sitemaps of a sitemap index", () => {
    const xml = `<sitemapindex>
      <sitemap><loc>https://apemp.in/sitemap-1.xml</loc></sitemap>
      <sitemap><loc>https://apemp.in/sitemap-2.xml</loc></sitemap>
    </sitemapindex>`;

    expect(parseFeed(xml).map((e) => e.url)).toEqual([
      "https://apemp.in/sitemap-1.xml",
      "https://apemp.in/sitemap-2.xml",
    ]);
    expect(isSitemapIndex(xml)).toBe(true);
  });

  it("reads RSS 2.0 items", () => {
    const xml = `<rss version="2.0"><channel>
      <title>apteachers</title>
      <item><title>New DA GO</title><link>https://www.apteachers.in/da-go</link>
        <pubDate>Tue, 15 Apr 2025 06:00:00 +0530</pubDate></item>
    </channel></rss>`;

    expect(parseFeed(xml)).toEqual([
      { url: "https://www.apteachers.in/da-go", lastmod: "Tue, 15 Apr 2025 06:00:00 +0530" },
    ]);
  });

  it("reads Atom entries, preferring the alternate link", () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <link rel="edit" href="https://example.in/edit/1"/>
        <link rel="alternate" href="https://gunturbadi.in/post-1"/>
        <updated>2025-04-15T06:00:00Z</updated>
      </entry>
    </feed>`;

    expect(parseFeed(xml)).toEqual([
      { url: "https://gunturbadi.in/post-1", lastmod: "2025-04-15T06:00:00Z" },
    ]);
  });

  it("drops relative and non-http URLs instead of passing junk downstream", () => {
    const xml = `<urlset>
      <url><loc>/relative/path</loc></url>
      <url><loc>javascript:alert(1)</loc></url>
      <url><loc>https://apemp.in/good</loc></url>
    </urlset>`;

    expect(parseFeed(xml)).toEqual([{ url: "https://apemp.in/good" }]);
  });

  it("de-duplicates a URL listed in both a sitemap and a feed section", () => {
    const xml = `<urlset>
      <url><loc>https://apemp.in/x</loc></url>
      <url><loc>https://apemp.in/x</loc></url>
    </urlset>`;

    expect(parseFeed(xml)).toHaveLength(1);
  });

  it("returns [] for junk rather than throwing", () => {
    // A malformed feed on one of six third-party sites at 3am costs that site's
    // discoveries for a night; it must not end the run.
    for (const junk of ["", "not xml at all", "<urlset><url><loc>", "<html><body>404</body></html>"]) {
      expect(parseFeed(junk), JSON.stringify(junk)).toEqual([]);
    }
  });
});

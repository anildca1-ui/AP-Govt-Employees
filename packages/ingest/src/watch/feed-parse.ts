import { XMLParser } from "fast-xml-parser";

/**
 * Sitemap and feed parsing for the discovery watcher.
 *
 * Deliberately forgiving: these are six third-party sites we do not control, and
 * a malformed feed on one of them at 3am must cost us that site's discoveries
 * for one night, not the whole run. Every parse failure returns [] rather than
 * throwing.
 */

export interface FeedEntry {
  url: string;
  /** Publication or last-modified date when the feed states one. */
  lastmod?: string;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
});

/** fast-xml-parser collapses a single-element list to a bare object. */
function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  // <loc>…</loc> with attributes parses to { "#text": "…" }.
  if (value !== null && typeof value === "object" && "#text" in value) {
    return text((value as Record<string, unknown>)["#text"]);
  }
  return null;
}

function entry(url: string | null, lastmod: string | null): FeedEntry | null {
  if (url === null) return null;
  try {
    // Reject relative or junk hrefs here so nothing downstream has to.
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  } catch {
    return null;
  }
  return lastmod === null ? { url } : { url, lastmod };
}

/**
 * Parses a sitemap (`urlset`), a sitemap index (`sitemapindex`), RSS 2.0 or
 * Atom. A sitemap index returns its child sitemap URLs — the caller decides
 * whether to follow them, so one polite fetch budget covers both levels.
 */
export function parseFeed(xml: string): FeedEntry[] {
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch {
    return [];
  }
  if (doc === null || typeof doc !== "object") return [];

  const out: FeedEntry[] = [];

  const urlset = doc.urlset as Record<string, unknown> | undefined;
  if (urlset !== undefined) {
    for (const url of asArray(urlset.url as Record<string, unknown> | Record<string, unknown>[])) {
      const item = entry(text(url?.loc), text(url?.lastmod));
      if (item !== null) out.push(item);
    }
  }

  const sitemapindex = doc.sitemapindex as Record<string, unknown> | undefined;
  if (sitemapindex !== undefined) {
    for (const sm of asArray(
      sitemapindex.sitemap as Record<string, unknown> | Record<string, unknown>[],
    )) {
      const item = entry(text(sm?.loc), text(sm?.lastmod));
      if (item !== null) out.push(item);
    }
  }

  const rss = doc.rss as Record<string, unknown> | undefined;
  const channel = rss?.channel as Record<string, unknown> | undefined;
  if (channel !== undefined) {
    for (const it of asArray(
      channel.item as Record<string, unknown> | Record<string, unknown>[],
    )) {
      const item = entry(text(it?.link), text(it?.pubDate));
      if (item !== null) out.push(item);
    }
  }

  const feed = doc.feed as Record<string, unknown> | undefined;
  if (feed !== undefined) {
    for (const it of asArray(feed.entry as Record<string, unknown> | Record<string, unknown>[])) {
      // Atom puts the URL in an attribute; prefer rel="alternate" when present.
      const links = asArray(it?.link as Record<string, unknown> | Record<string, unknown>[]);
      const chosen =
        links.find((l) => text(l?.["@_rel"]) === "alternate" || l?.["@_rel"] === undefined) ??
        links[0];
      const href = chosen === undefined ? null : text(chosen["@_href"]);
      const item = entry(href, text(it?.updated) ?? text(it?.published));
      if (item !== null) out.push(item);
    }
  }

  // The same URL can appear in both a sitemap and a feed on one site.
  const seen = new Set<string>();
  return out.filter((item) => (seen.has(item.url) ? false : (seen.add(item.url), true)));
}

/** True when the document is a sitemap index rather than a list of pages. */
export function isSitemapIndex(xml: string): boolean {
  return /<sitemapindex[\s>]/i.test(xml);
}

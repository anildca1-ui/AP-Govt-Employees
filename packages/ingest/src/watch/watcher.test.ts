import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { ScraperConfig } from "../config.js";
import { diffAgainstSeen } from "./diff.js";
import { runWatch } from "./watcher.js";
import type { WatchedSite } from "./sites.js";

const CONFIG: ScraperConfig = {
  contactEmail: "admin@ap-emp-ai.in",
  userAgent: "ap-emp-ai-bot (contact: admin@ap-emp-ai.in)",
  // Zero so the tests do not actually wait out the 2s floor; the floor itself is
  // covered by rate-limiter.test.ts.
  minDelayMs: 0,
  downloadDir: ".downloads",
};

interface FakeState {
  seen: Set<string>;
  inserted: Record<string, unknown>[];
  upserted: Record<string, unknown>[];
}

function makeState(seen: string[] = []): FakeState {
  return { seen: new Set(seen), inserted: [], upserted: [] };
}

/** Enough of the PostgREST builder for watch_seen and ingest_queue. */
class FakeQuery {
  #table: string;
  #state: FakeState;

  constructor(table: string, state: FakeState) {
    this.#table = table;
    this.#state = state;
  }
  select(): this {
    return this;
  }
  eq(): this {
    return this;
  }
  in(_column: string, values: string[]): Promise<{ data: { url: string }[]; error: null }> {
    const data = values.filter((u) => this.#state.seen.has(u)).map((url) => ({ url }));
    return Promise.resolve({ data, error: null });
  }
  upsert(rows: Record<string, unknown>[]): Promise<{ error: null }> {
    for (const row of rows) {
      this.#state.upserted.push(row);
      this.#state.seen.add(row.url as string);
    }
    return Promise.resolve({ error: null });
  }
  insert(row: Record<string, unknown>): Promise<{ error: null }> {
    if (this.#table === "ingest_queue") this.#state.inserted.push(row);
    return Promise.resolve({ error: null });
  }
}

function makeDb(state: FakeState): SupabaseClient {
  return { from: (table: string) => new FakeQuery(table, state) } as unknown as SupabaseClient;
}

const SITEMAP = `<urlset>
  <url><loc>https://apemp.in/go-51</loc><lastmod>2025-04-15</lastmod></url>
  <url><loc>https://apemp.in/go-52</loc></url>
</urlset>`;

function stubFetch(routes: Record<string, { status?: number; body: string }>): typeof fetch {
  return (async (input: string) => {
    const url = String(input);
    const hit = routes[url];
    if (hit === undefined) return new Response("not found", { status: 404 });
    return new Response(hit.body, { status: hit.status ?? 200 });
  }) as unknown as typeof fetch;
}

const SITE: WatchedSite = {
  id: "apemp",
  origin: "https://apemp.in",
  feeds: ["https://apemp.in/sitemap.xml", "https://apemp.in/feed"],
};

describe("diffAgainstSeen", () => {
  it("returns only URLs not seen before on that site", async () => {
    const state = makeState(["https://apemp.in/go-51"]);
    const fresh = await diffAgainstSeen(makeDb(state), "apemp", [
      { url: "https://apemp.in/go-51" },
      { url: "https://apemp.in/go-52" },
    ]);

    expect(fresh.map((f) => f.url)).toEqual(["https://apemp.in/go-52"]);
  });

  it("records what it returned, so the next run sees nothing new", async () => {
    const state = makeState();
    const first = await diffAgainstSeen(makeDb(state), "apemp", [{ url: "https://apemp.in/a" }]);
    const second = await diffAgainstSeen(makeDb(state), "apemp", [{ url: "https://apemp.in/a" }]);

    expect(first).toHaveLength(1);
    expect(second).toEqual([]);
  });

  it("de-duplicates within a single feed", async () => {
    const state = makeState();
    const fresh = await diffAgainstSeen(makeDb(state), "apemp", [
      { url: "https://apemp.in/a" },
      { url: "https://apemp.in/a" },
    ]);

    expect(fresh).toHaveLength(1);
  });

  it("short-circuits on an empty feed without touching the database", async () => {
    const state = makeState();
    expect(await diffAgainstSeen(makeDb(state), "apemp", [])).toEqual([]);
    expect(state.upserted).toEqual([]);
  });
});

describe("runWatch", () => {
  it("queues a lead per new URL, marked as discovery rather than a document", async () => {
    const state = makeState();
    const fetchImpl = stubFetch({
      "https://apemp.in/robots.txt": { body: "User-agent: *\nDisallow:\n" },
      "https://apemp.in/sitemap.xml": { body: SITEMAP },
    });

    const [summary] = await runWatch({
      db: makeDb(state),
      config: CONFIG,
      sites: [SITE],
      fetchImpl,
    });

    expect(summary).toMatchObject({ site: "apemp", entriesSeen: 2, newUrls: 2, queued: 2 });
    expect(state.inserted).toHaveLength(2);

    const row = state.inserted[0] as Record<string, unknown>;
    expect(row.source).toBe("discovery:apemp");
    expect(row.status).toBe("pending");
    // The reviewer must not mistake a lead for an ingested GO: no sha256, and a
    // note saying to fetch the official PDF instead of the reference page.
    expect(row.sha256).toBeUndefined();
    expect(String((row.meta as Record<string, unknown>).note)).toMatch(/official PDF/i);
    expect(String((row.meta as Record<string, unknown>).note)).toMatch(/do not ingest/i);
  });

  it("queues nothing on a second run over an unchanged feed", async () => {
    const state = makeState();
    const fetchImpl = stubFetch({
      "https://apemp.in/robots.txt": { body: "User-agent: *\nDisallow:\n" },
      "https://apemp.in/sitemap.xml": { body: SITEMAP },
    });
    const args = { db: makeDb(state), config: CONFIG, sites: [SITE], fetchImpl };

    await runWatch(args);
    const before = state.inserted.length;
    const [second] = await runWatch(args);

    expect(second?.queued).toBe(0);
    expect(state.inserted).toHaveLength(before);
  });

  it("skips a feed robots.txt disallows", async () => {
    const state = makeState();
    const fetchImpl = stubFetch({
      "https://apemp.in/robots.txt": { body: "User-agent: *\nDisallow: /sitemap.xml\n" },
      "https://apemp.in/feed": { body: SITEMAP },
    });

    const [summary] = await runWatch({
      db: makeDb(state),
      config: CONFIG,
      sites: [SITE],
      fetchImpl,
    });

    // Falls through to the next candidate feed rather than giving up.
    expect(summary?.feedUrl).toBe("https://apemp.in/feed");
    expect(summary?.queued).toBe(2);
  });

  it("keeps going when one site is unreachable", async () => {
    // An unreadable robots.txt aborts that site only — the other five still run.
    const state = makeState();
    const down: WatchedSite = { id: "down", origin: "https://down.in", feeds: ["https://down.in/f"] };
    const fetchImpl = stubFetch({
      "https://down.in/robots.txt": { status: 503, body: "nope" },
      "https://apemp.in/robots.txt": { body: "User-agent: *\nDisallow:\n" },
      "https://apemp.in/sitemap.xml": { body: SITEMAP },
    });

    const summaries = await runWatch({
      db: makeDb(state),
      config: CONFIG,
      sites: [down, SITE],
      fetchImpl,
    });

    expect(summaries[0]?.skipped).toMatch(/Refusing to crawl/);
    expect(summaries[1]?.queued).toBe(2);
  });

  it("reports a site with no usable feed instead of failing the run", async () => {
    const state = makeState();
    const fetchImpl = stubFetch({
      "https://apemp.in/robots.txt": { body: "User-agent: *\nDisallow:\n" },
      "https://apemp.in/sitemap.xml": { body: "<html>not a feed</html>" },
      "https://apemp.in/feed": { status: 404, body: "" },
    });

    const [summary] = await runWatch({
      db: makeDb(state),
      config: CONFIG,
      sites: [SITE],
      fetchImpl,
    });

    expect(summary?.skipped).toBe("no usable feed");
    expect(summary?.queued).toBe(0);
  });

  it("caps how much one site can queue in a single night", async () => {
    const many = Array.from({ length: 20 }, (_, i) => `<url><loc>https://apemp.in/p${i}</loc></url>`);
    const state = makeState();
    const fetchImpl = stubFetch({
      "https://apemp.in/robots.txt": { body: "User-agent: *\nDisallow:\n" },
      "https://apemp.in/sitemap.xml": { body: `<urlset>${many.join("")}</urlset>` },
    });

    const [summary] = await runWatch({
      db: makeDb(state),
      config: CONFIG,
      sites: [SITE],
      fetchImpl,
      maxPerSite: 5,
    });

    expect(summary?.queued).toBe(5);
  });

  it("sends the identifying User-Agent on every feed request", async () => {
    const seenAgents: string[] = [];
    const state = makeState();
    const fetchImpl = (async (input: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (headers["User-Agent"]) seenAgents.push(headers["User-Agent"]);
      const url = String(input);
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nDisallow:\n");
      return new Response(SITEMAP);
    }) as unknown as typeof fetch;

    await runWatch({ db: makeDb(state), config: CONFIG, sites: [SITE], fetchImpl });

    expect(seenAgents.length).toBeGreaterThan(0);
    expect(new Set(seenAgents)).toEqual(new Set([CONFIG.userAgent]));
  });
});

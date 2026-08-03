import { describe, expect, it } from "vitest";
import { RobotsGate } from "./robots.js";

const CONTACT = "admin@ap-emp-ai.in";

function stubFetch(status: number, body: string): typeof fetch {
  return (async () =>
    new Response(body, { status, headers: { "content-type": "text/plain" } })) as typeof fetch;
}

describe("RobotsGate", () => {
  it("blocks a disallowed path and permits the rest", async () => {
    const gate = new RobotsGate({
      origin: "https://goir.ap.gov.in",
      contactEmail: CONTACT,
      fetchImpl: stubFetch(200, "User-agent: *\nDisallow: /admin/\n"),
    });
    await gate.load();

    expect(gate.isAllowed("https://goir.ap.gov.in/admin/panel")).toBe(false);
    expect(gate.isAllowed("https://goir.ap.gov.in/GoView")).toBe(true);
  });

  it("honours a rule aimed specifically at our bot", async () => {
    const gate = new RobotsGate({
      origin: "https://goir.ap.gov.in",
      contactEmail: CONTACT,
      fetchImpl: stubFetch(
        200,
        "User-agent: *\nDisallow:\n\nUser-agent: ap-emp-ai-bot\nDisallow: /search\n",
      ),
    });
    await gate.load();

    expect(gate.isAllowed("https://goir.ap.gov.in/search?q=1")).toBe(false);
  });

  it("treats a missing robots.txt as no restrictions", async () => {
    const gate = new RobotsGate({
      origin: "https://goir.ap.gov.in",
      contactEmail: CONTACT,
      fetchImpl: stubFetch(404, "Not found"),
    });
    await gate.load();

    expect(gate.isAllowed("https://goir.ap.gov.in/anything")).toBe(true);
  });

  it("refuses to crawl when robots.txt cannot be read", async () => {
    // A site returning 500 or rate-limiting us is the last one to hammer, so an
    // unreadable robots.txt must not be read as permission.
    for (const status of [500, 503, 403, 429]) {
      const gate = new RobotsGate({
        origin: "https://goir.ap.gov.in",
        contactEmail: CONTACT,
        fetchImpl: stubFetch(status, "error"),
      });
      await expect(gate.load(), `HTTP ${status}`).rejects.toThrow(/Refusing to crawl/);
    }
  });

  it("will not answer before robots.txt has been read", async () => {
    const gate = new RobotsGate({
      origin: "https://goir.ap.gov.in",
      contactEmail: CONTACT,
      fetchImpl: stubFetch(200, ""),
    });

    expect(() => gate.isAllowed("https://goir.ap.gov.in/GoView")).toThrow(/must be awaited/);
  });

  it("requires a real contact address before it will even be constructed", () => {
    expect(
      () =>
        new RobotsGate({
          origin: "https://goir.ap.gov.in",
          contactEmail: "someone@example.com",
          fetchImpl: stubFetch(200, ""),
        }),
    ).toThrow(/SCRAPER_CONTACT_EMAIL/);
  });

  it("reports a Crawl-delay so the caller can slow down to the site's wishes", async () => {
    const gate = new RobotsGate({
      origin: "https://goir.ap.gov.in",
      contactEmail: CONTACT,
      fetchImpl: stubFetch(200, "User-agent: *\nCrawl-delay: 10\n"),
    });
    await gate.load();

    expect(gate.crawlDelayMs()).toBe(10_000);
  });

  it("reports no Crawl-delay when the site does not ask for one", async () => {
    const gate = new RobotsGate({
      origin: "https://goir.ap.gov.in",
      contactEmail: CONTACT,
      fetchImpl: stubFetch(200, "User-agent: *\nDisallow: /admin/\n"),
    });
    await gate.load();

    expect(gate.crawlDelayMs()).toBeNull();
  });

  it("sends the identifying User-Agent when fetching robots.txt itself", async () => {
    let seen: string | undefined;
    const gate = new RobotsGate({
      origin: "https://goir.ap.gov.in",
      contactEmail: CONTACT,
      fetchImpl: (async (_url: string, init?: RequestInit) => {
        seen = (init?.headers as Record<string, string> | undefined)?.["User-Agent"];
        return new Response("", { status: 200 });
      }) as unknown as typeof fetch,
    });
    await gate.load();

    expect(seen).toBe(`ap-emp-ai-bot (contact: ${CONTACT})`);
  });
});

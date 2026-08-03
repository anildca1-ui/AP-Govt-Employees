import { describe, expect, it } from "vitest";
import { loadScraperConfig, loadSupabaseConfig, MIN_DELAY_FLOOR_MS } from "./config.js";

const GOOD_EMAIL = "admin@ap-emp-ai.in";

describe("loadScraperConfig", () => {
  it("builds the identifying User-Agent from the contact address", () => {
    const config = loadScraperConfig({ SCRAPER_CONTACT_EMAIL: GOOD_EMAIL });

    expect(config.userAgent).toBe(`ap-emp-ai-bot (contact: ${GOOD_EMAIL})`);
    expect(config.minDelayMs).toBe(MIN_DELAY_FLOOR_MS);
  });

  it("fails before any request when the contact address is missing", () => {
    expect(() => loadScraperConfig({})).toThrow(/SCRAPER_CONTACT_EMAIL/);
    expect(() => loadScraperConfig({ SCRAPER_CONTACT_EMAIL: "<contact-email>" })).toThrow(
      /placeholder/,
    );
  });

  it("treats a delay below the floor as a mistake, not an instruction", () => {
    // Nothing in .env should be able to make the crawler faster than rule 3.
    for (const value of ["0", "100", "-5", "not a number"]) {
      const config = loadScraperConfig({
        SCRAPER_CONTACT_EMAIL: GOOD_EMAIL,
        SCRAPER_MIN_DELAY_MS: value,
      });
      expect(config.minDelayMs, value).toBe(MIN_DELAY_FLOOR_MS);
    }
  });

  it("honours a delay slower than the floor", () => {
    const config = loadScraperConfig({
      SCRAPER_CONTACT_EMAIL: GOOD_EMAIL,
      SCRAPER_MIN_DELAY_MS: "5000",
    });

    expect(config.minDelayMs).toBe(5000);
  });
});

describe("loadSupabaseConfig", () => {
  it("requires the service role key, since RLS hides ingest_queue from anon", () => {
    expect(() => loadSupabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321" })).toThrow(
      /SUPABASE_SERVICE_ROLE_KEY/,
    );
    expect(() => loadSupabaseConfig({ SUPABASE_SERVICE_ROLE_KEY: "key" })).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL/,
    );
  });

  it("returns both values when present", () => {
    expect(
      loadSupabaseConfig({
        NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
        SUPABASE_SERVICE_ROLE_KEY: "service-key",
      }),
    ).toEqual({ url: "http://localhost:54321", serviceRoleKey: "service-key" });
  });
});

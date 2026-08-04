import { describe, expect, it } from "vitest";
import { diagnose } from "./diagnose.js";

const context = {
  url: "https://goir.ap.gov.in/",
  userAgent: "ap-emp-ai-bot (contact: someone@example.org)",
};

describe("diagnose", () => {
  it("separates 'cannot reach it' from 'it refused me'", () => {
    // The two need opposite responses — one is a network to fix, the other is a
    // site to ask permission from — and Node reports the first as a bare
    // "fetch failed" with nothing else to go on.
    const unreachable = diagnose(new TypeError("fetch failed"), context);
    expect(unreachable.summary).toMatch(/could not reach/i);
    expect(unreachable.nextSteps.join(" ")).toMatch(/VPN|proxy|sandbox/i);

    const refused = diagnose(
      new Error("Could not read https://goir.ap.gov.in/robots.txt (HTTP 403)."),
      context,
    );
    expect(refused.summary).toMatch(/refused/i);
    expect(refused.summary).toMatch(/403/);
  });

  it("does not suggest disguising the bot when a site blocks it", () => {
    // The contact address in the User-Agent is the whole politeness bargain
    // (CLAUDE.md rule 3). Advising a spoof here would undo it.
    const steps = diagnose(new Error("HTTP 403"), context).nextSteps.join(" ");

    expect(steps).toMatch(/do not disguise/i);
    expect(steps).toMatch(/contact the site/i);
  });

  it("treats rate limiting as a reason to slow down, not to retry", () => {
    const steps = diagnose(new Error("HTTP 429"), context).nextSteps.join(" ");

    expect(steps).toMatch(/wait/i);
    expect(steps).toMatch(/SCRAPER_MIN_DELAY_MS/);
  });

  it("blames the site, not the selectors, for a 5xx", () => {
    const diagnosis = diagnose(new Error("HTTP 503"), context);

    expect(diagnosis.summary).toMatch(/server error/i);
    expect(diagnosis.nextSteps.join(" ")).toMatch(/not the selectors/i);
  });

  it("recognises a missing Playwright browser", () => {
    const diagnosis = diagnose(
      new Error("browserType.launch: Executable doesn't exist at /root/.cache/ms-playwright"),
      context,
    );

    expect(diagnosis.nextSteps.join(" ")).toMatch(/playwright install chromium/);
  });

  it("passes the contact-email refusal through with its own guidance", () => {
    const diagnosis = diagnose(
      new Error("Refusing to scrape: SCRAPER_CONTACT_EMAIL is not set."),
      context,
    );

    expect(diagnosis.summary).toMatch(/SCRAPER_CONTACT_EMAIL/);
    expect(diagnosis.nextSteps.join(" ")).toMatch(/monitored address/i);
  });

  it("says so plainly when it does not recognise the failure", () => {
    // Better than inventing a confident diagnosis for something unknown.
    const diagnosis = diagnose(new Error("something entirely new"), context);

    expect(diagnosis.summary).toBe("something entirely new");
    expect(diagnosis.nextSteps.join(" ")).toMatch(/not a known failure mode/i);
  });

  it("survives a non-Error and a malformed url", () => {
    expect(diagnose("just a string", { url: "not a url", userAgent: "x" }).summary).toBe(
      "just a string",
    );
  });
});

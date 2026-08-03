import { describe, expect, it } from "vitest";
import { buildUserAgent, MissingContactEmailError } from "./user-agent.js";

describe("buildUserAgent", () => {
  it("identifies the bot and carries a reachable contact address", () => {
    expect(buildUserAgent("admin@ap-emp-ai.in")).toBe("ap-emp-ai-bot (contact: admin@ap-emp-ai.in)");
  });

  it("trims incidental whitespace", () => {
    expect(buildUserAgent("  admin@ap-emp-ai.in  ")).toBe(
      "ap-emp-ai-bot (contact: admin@ap-emp-ai.in)",
    );
  });

  it("refuses to build when nobody has filled the address in", () => {
    // Each of these would otherwise ship a crawler that no administrator can
    // reach, which is how you get IP-banned instead of emailed.
    for (const value of [
      undefined,
      "",
      "   ",
      "<contact-email>",
      "someone@example.com",
      "test@example.invalid",
      "unset@somewhere.in",
      "TODO",
      "changeme@site.in",
    ]) {
      expect(() => buildUserAgent(value), String(value)).toThrow(MissingContactEmailError);
    }
  });

  it("refuses a value that is not an address at all", () => {
    for (const value of ["ap-emp-ai", "http://ap-emp-ai.in", "admin@localhost", "a@b"]) {
      expect(() => buildUserAgent(value), value).toThrow(MissingContactEmailError);
    }
  });

  it("explains what to do in the error message", () => {
    expect(() => buildUserAgent("")).toThrow(/SCRAPER_CONTACT_EMAIL/);
    expect(() => buildUserAgent("")).toThrow(/real, monitored address/);
  });
});

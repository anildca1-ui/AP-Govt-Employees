import { describe, expect, it } from "vitest";
import { scrubEvent, scrubUrl, type ScrubbableEvent } from "./scrub";

/**
 * CLAUDE.md rule 7 keeps personal data in one place. An error tracker that
 * attaches request bodies quietly makes itself a second place, so these assert
 * on what must NOT survive rather than on what does.
 */
describe("scrubUrl", () => {
  it("redacts a prefilled basic pay out of a shared calculator link", () => {
    // The dashboard prefills calculators with ?basicPay=, so this parameter
    // reaches the server on ordinary, non-error traffic too.
    expect(scrubUrl("https://x/te/calculators/salary?basicPay=52590")).toContain("[redacted]");
    expect(scrubUrl("https://x/te/calculators/salary?basicPay=52590")).not.toContain("52590");
  });

  it("keeps parameters that describe the page rather than the person", () => {
    const scrubbed = scrubUrl("https://x/te/gos?dept=Finance&page=3&phone=%2B919999999999");

    expect(scrubbed).toContain("dept=Finance");
    expect(scrubbed).toContain("page=3");
    expect(scrubbed).not.toContain("919999999999");
  });

  it("leaves the path alone — a GO number is public", () => {
    expect(scrubUrl("https://x/te/gos/G.O.Ms.No.60")).toContain("G.O.Ms.No.60");
  });

  it("returns something usable for a relative or malformed url", () => {
    expect(scrubUrl("/te/chat")).toBe("/te/chat");
    expect(scrubUrl("::::")).toBe("::::");
  });
});

describe("scrubEvent", () => {
  it("drops the request body, where every sensitive field actually lives", () => {
    const event: ScrubbableEvent = {
      request: {
        url: "https://x/api/chat",
        data: { question: "నా సర్వీస్ రికార్డ్ గురించి", phone: "+919999999999" },
        cookies: { admin_token: "secret" },
        query_string: "phone=%2B919999999999",
      },
    };

    const scrubbed = scrubEvent(event);

    expect(scrubbed.request?.data).toBeUndefined();
    expect(scrubbed.request?.cookies).toBeUndefined();
    expect(scrubbed.request?.query_string).toBeUndefined();
    expect(JSON.stringify(scrubbed)).not.toContain("919999999999");
    expect(JSON.stringify(scrubbed)).not.toContain("secret");
  });

  it("keeps only headers that describe the request, never the requester", () => {
    const event: ScrubbableEvent = {
      request: {
        headers: {
          "content-type": "application/json",
          cookie: "admin_token=secret",
          authorization: "Bearer live-key",
          "x-forwarded-for": "203.0.113.9",
        },
      },
    };

    const headers = scrubEvent(event).request?.headers ?? {};

    expect(headers["content-type"]).toBe("application/json");
    expect(headers.cookie).toBeUndefined();
    expect(headers.authorization).toBeUndefined();
    expect(headers["x-forwarded-for"]).toBeUndefined();
  });

  it("removes any inferred user", () => {
    expect(scrubEvent({ user: { id: "uuid", ip_address: "203.0.113.9" } }).user).toBeUndefined();
  });

  it("masks long digit runs in breadcrumbs but leaves GO numbers readable", () => {
    const event: ScrubbableEvent = {
      breadcrumbs: [
        { message: "POST /api/chat for +919999999999" },
        { message: "cited G.O.Ms.No.60, HTTP 500" },
        { data: { url: "https://x/te/calculators/nps?basicPay=52590" } },
      ],
    };

    const crumbs = scrubEvent(event).breadcrumbs ?? [];

    expect(crumbs[0]?.message).not.toContain("919999999999");
    // Short numbers are how a stack trace stays readable.
    expect(crumbs[1]?.message).toBe("cited G.O.Ms.No.60, HTTP 500");
    expect(String(crumbs[2]?.data?.url)).not.toContain("52590");
  });

  it("does not throw on an empty event", () => {
    expect(() => scrubEvent({})).not.toThrow();
  });
});

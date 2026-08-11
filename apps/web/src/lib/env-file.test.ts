import { describe, expect, it } from "vitest";
// A plain .mjs helper shared with the setup script, which runs under bare node
// and so is deliberately not TypeScript. Typed here at the boundary rather than
// silenced, so a signature change is still caught.
import * as envFile from "../../../../scripts/lib/env-file.mjs";

const { buildEnv, clean, warningsFor, parseSupabaseStart } = envFile as {
  buildEnv: (example: string, values: Record<string, string>) => string;
  clean: (value: string) => string;
  warningsFor: (input: { url: string; anon: string; service: string }) => string[];
  parseSupabaseStart: (output: string) => Record<string, string | null>;
};

/**
 * `pnpm setup:env` writes the file that holds the owner's Supabase keys. The
 * asking needs a terminal and cannot be tested here, but everything that can
 * silently corrupt the result can: a value landing on the wrong line, a stray
 * quote kept, or the rest of the template being lost.
 *
 * Getting this wrong is expensive in a specific way — the file looks right,
 * and the failure surfaces much later as an unhelpful connection error.
 */
describe("clean", () => {
  it.each([
    ["  https://x.supabase.co  ", "https://x.supabase.co"],
    ['"quoted-key"', "quoted-key"],
    ["'single'", "single"],
    ["plain", "plain"],
  ])("%j → %j", (input, expected) => {
    expect(clean(input)).toBe(expected);
  });
});

describe("buildEnv", () => {
  const example = [
    "# A comment",
    "",
    "NEXT_PUBLIC_SITE_URL=http://localhost:3000",
    "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY=",
    "SUPABASE_SERVICE_ROLE_KEY=",
    "ADMIN_TOKEN=",
    "# trailing comment",
  ].join("\n");

  const values = {
    NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-123",
    SUPABASE_SERVICE_ROLE_KEY: "service-456",
    ADMIN_TOKEN: "generated-token",
  };

  it("sets each value on its own line", () => {
    const written = buildEnv(example, values);

    expect(written).toContain("NEXT_PUBLIC_SUPABASE_URL=https://abc.supabase.co");
    expect(written).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY=anon-123");
    expect(written).toContain("SUPABASE_SERVICE_ROLE_KEY=service-456");
    expect(written).toContain("ADMIN_TOKEN=generated-token");
  });

  it("leaves comments, blanks and untouched settings exactly as they were", () => {
    const written = buildEnv(example, values).split("\n");

    expect(written[0]).toBe("# A comment");
    expect(written[1]).toBe("");
    // Not in `values`, so it keeps the template's own default.
    expect(written).toContain("NEXT_PUBLIC_SITE_URL=http://localhost:3000");
    expect(written.at(-1)).toBe("# trailing comment");
  });

  it("never puts the service_role key on the anon line", () => {
    // The keys look alike, and swapping them hands the browser a key that
    // bypasses every security rule.
    const written = buildEnv(example, values);
    const anonLine = written.split("\n").find((l: string) => l.startsWith("NEXT_PUBLIC_SUPABASE_ANON_KEY="));

    expect(anonLine).toBe("NEXT_PUBLIC_SUPABASE_ANON_KEY=anon-123");
    expect(anonLine).not.toContain("service");
  });

  it("strips quotes a person copied along with the value", () => {
    const written = buildEnv(example, { ADMIN_TOKEN: '"tok en"' });
    expect(written).toContain("ADMIN_TOKEN=tok en");
  });

  it("keeps the same number of lines, so nothing is dropped", () => {
    expect(buildEnv(example, values).split("\n")).toHaveLength(example.split("\n").length);
  });
});

describe("warningsFor", () => {
  const good = {
    url: "https://abcdefgh.supabase.co",
    anon: "anon-1",
    service: "service-2",
  };

  it("says nothing when the values look right", () => {
    expect(warningsFor(good)).toEqual([]);
  });

  it("flags a URL that is not a Supabase project", () => {
    // Pasting the dashboard address instead of the API URL is the common slip.
    expect(warningsFor({ ...good, url: "https://supabase.com/dashboard/project/abc" })).toHaveLength(1);
  });

  it("flags the same key pasted into both slots", () => {
    expect(warningsFor({ ...good, service: good.anon })[0]).toMatch(/identical/);
  });
});

describe("parseSupabaseStart", () => {
  // The CLI's real summary block, right-aligned labels and all.
  const classic = `Started supabase local development setup.

         API URL: http://127.0.0.1:54321
     GraphQL URL: http://127.0.0.1:54321/graphql/v1
          DB URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres
      Studio URL: http://127.0.0.1:54323
    Inbucket URL: http://127.0.0.1:54324
      JWT secret: super-secret-jwt-token-with-at-least-32-characters-long
        anon key: eyJhbGci.anon.token
service_role key: eyJhbGci.service.token
`;

  it("reads the URL and both keys", () => {
    expect(parseSupabaseStart(classic)).toMatchObject({
      url: "http://127.0.0.1:54321",
      anon: "eyJhbGci.anon.token",
      service: "eyJhbGci.service.token",
      studio: "http://127.0.0.1:54323",
    });
  });

  it("never mistakes the JWT secret for a key", () => {
    // They sit adjacent in the output and a loose match would take the wrong
    // one, producing an .env that looks filled in and cannot authenticate.
    const parsed = parseSupabaseStart(classic);
    expect(parsed.anon).not.toContain("super-secret");
    expect(parsed.service).not.toContain("super-secret");
  });

  it("accepts the CLI's newer key names", () => {
    // Renamed upstream: an unrecognised label would silently write empty keys.
    const renamed = `         API URL: http://127.0.0.1:54321
publishable key: sb_publishable_abc
     secret key: sb_secret_xyz
`;
    expect(parseSupabaseStart(renamed)).toMatchObject({
      url: "http://127.0.0.1:54321",
      anon: "sb_publishable_abc",
      service: "sb_secret_xyz",
    });
  });

  it("reports null rather than guessing when a label is absent", () => {
    expect(parseSupabaseStart("nothing useful here").anon).toBeNull();
  });
});

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
  /**
   * The exact SHAPE a real `supabase start` prints on Windows — box-drawing
   * tables, not "label: value". The previous fixture here was invented from
   * memory, passed, and the parser still failed on a real machine.
   *
   * The key VALUES are deliberately fake. The first version of this fixture
   * pasted a real run's keys, and GitHub's secret scanner refused the push —
   * correctly. A test needs the format to be real, never the credential, and
   * "it is only a local database" is exactly the reasoning that puts a live
   * key in a repository one day.
   */
  const tables = `Started supabase local development setup.

╭──────────────────────────────────────╮
│ 🔧 Development Tools                 │
├─────────┬────────────────────────────┤
│ Studio  │ http://127.0.0.1:54323     │
│ Mailpit │ http://127.0.0.1:54324     │
│ MCP     │ http://127.0.0.1:54321/mcp │
╰─────────┴────────────────────────────╯

╭──────────────────────────────────────────────────────╮
│ 🌐 APIs                                              │
├────────────────┬─────────────────────────────────────┤
│ Project URL    │ http://127.0.0.1:54321              │
│ REST           │ http://127.0.0.1:54321/rest/v1      │
│ GraphQL        │ http://127.0.0.1:54321/graphql/v1   │
│ Edge Functions │ http://127.0.0.1:54321/functions/v1 │
╰────────────────┴─────────────────────────────────────╯

╭───────────────────────────────────────────────────────────────╮
│ ⛁ Database                                                    │
├─────┬─────────────────────────────────────────────────────────┤
│ URL │ postgresql://postgres:postgres@127.0.0.1:54322/postgres │
╰─────┴─────────────────────────────────────────────────────────╯

╭──────────────────────────────────────────────────────────────╮
│ 🔑 Authentication Keys                                       │
├─────────────┬────────────────────────────────────────────────┤
│ Publishable │ sb_publishable_EXAMPLEexampleEXAMPLEexample │
│ Secret      │ sb_secret_EXAMPLEexampleEXAMPLEexample      │
╰─────────────┴────────────────────────────────────────────────╯
`;

  it("reads the real table output the CLI prints today", () => {
    expect(parseSupabaseStart(tables)).toMatchObject({
      url: "http://127.0.0.1:54321",
      anon: "sb_publishable_EXAMPLEexampleEXAMPLEexample",
      service: "sb_secret_EXAMPLEexampleEXAMPLEexample",
      studio: "http://127.0.0.1:54323",
    });
  });

  it("keeps the database URL distinct from the API's Project URL", () => {
    // Both rows are labelled with something ending in "URL"; a loose match
    // would point the site at Postgres directly, which it cannot speak.
    const parsed = parseSupabaseStart(tables);
    expect(parsed.url).toBe("http://127.0.0.1:54321");
    expect(parsed.dbUrl).toBe("postgresql://postgres:postgres@127.0.0.1:54322/postgres");
  });

  it("never takes REST or GraphQL as the project URL", () => {
    const parsed = parseSupabaseStart(tables);
    expect(parsed.url).not.toContain("/rest/v1");
    expect(parsed.url).not.toContain("/graphql/v1");
  });

  it("still reads the older label: value output", () => {
    const classic = `         API URL: http://127.0.0.1:54321
      Studio URL: http://127.0.0.1:54323
      JWT secret: super-secret-jwt-token-with-at-least-32-characters-long
        anon key: eyJhbGci.anon.token
service_role key: eyJhbGci.service.token
`;
    expect(parseSupabaseStart(classic)).toMatchObject({
      url: "http://127.0.0.1:54321",
      anon: "eyJhbGci.anon.token",
      service: "eyJhbGci.service.token",
    });
  });

  it("never mistakes the JWT secret for a key", () => {
    const classic = `      JWT secret: super-secret-jwt-token
        anon key: eyJhbGci.anon.token
service_role key: eyJhbGci.service.token
`;
    const parsed = parseSupabaseStart(classic);
    expect(parsed.anon).not.toContain("super-secret");
    expect(parsed.service).not.toContain("super-secret");
  });

  it("reports null rather than guessing when nothing matches", () => {
    expect(parseSupabaseStart("nothing useful here").anon).toBeNull();
  });
});

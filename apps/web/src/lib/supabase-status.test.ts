import { describe, expect, it } from "vitest";
import * as status from "../../../../scripts/lib/supabase-status.mjs";

const { parseSupabaseEnv, parseSupabaseStart, stripAnsi } = status as {
  parseSupabaseEnv: (output: string) => Record<string, string | null>;
  parseSupabaseStart: (output: string) => Record<string, string | null>;
  stripAnsi: (text: string) => string;
};

/**
 * Reading the local stack's keys, which took three tries to get right on a real
 * machine and is worth the tests that record why.
 *
 * 1. I parsed a right-aligned "label: value" shape written from memory. The CLI
 *    prints box-drawing tables. Failed.
 * 2. I parsed the tables, using the owner's real output. Failed again — the
 *    cells carry ANSI colour codes that survive capture to a pipe, so the label
 *    "Project URL" is really "ESC[1mProject URLESC[0m".
 * 3. The CLI has --output env: plain KEY="value", no colour, no layout. That is
 *    now the primary path, and parsing the display is the fallback.
 *
 * The values below are all fake. An earlier fixture pasted a real run's keys
 * and GitHub's push protection refused it, correctly.
 */
const ESC = String.fromCharCode(27);

describe("parseSupabaseEnv — the machine-readable path", () => {
  const output = [
    'API_URL="http://127.0.0.1:54321"',
    'ANON_KEY="sb_publishable_EXAMPLEexample"',
    'SERVICE_ROLE_KEY="sb_secret_EXAMPLEexample"',
    'DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"',
    'STUDIO_URL="http://127.0.0.1:54323"',
  ].join("\n");

  it("reads every value the app needs", () => {
    expect(parseSupabaseEnv(output)).toEqual({
      url: "http://127.0.0.1:54321",
      anon: "sb_publishable_EXAMPLEexample",
      service: "sb_secret_EXAMPLEexample",
      dbUrl: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      studio: "http://127.0.0.1:54323",
    });
  });

  it("accepts the CLI's renamed keys", () => {
    const renamed = 'API_URL="http://127.0.0.1:54321"\nPUBLISHABLE_KEY="pk"\nSECRET_KEY="sk"';
    expect(parseSupabaseEnv(renamed)).toMatchObject({ anon: "pk", service: "sk" });
  });

  it("treats an empty value as absent rather than writing a blank key", () => {
    expect(parseSupabaseEnv('ANON_KEY=""').anon).toBeNull();
  });

  it("survives colour codes", () => {
    expect(parseSupabaseEnv(`${ESC}[32mAPI_URL${ESC}[0m="http://x"`).url).toBe("http://x");
  });
});

describe("parseSupabaseStart — the display fallback", () => {
  it("reads coloured table cells, which is what defeated the previous version", () => {
    const coloured =
      `| ${ESC}[1mProject URL${ESC}[0m | http://127.0.0.1:54321 |\n` +
      `| ${ESC}[1mPublishable${ESC}[0m | sb_publishable_EXAMPLEexample |\n` +
      `| ${ESC}[1mSecret${ESC}[0m | sb_secret_EXAMPLEexample |\n`;

    expect(parseSupabaseStart(coloured)).toMatchObject({
      url: "http://127.0.0.1:54321",
      anon: "sb_publishable_EXAMPLEexample",
      service: "sb_secret_EXAMPLEexample",
    });
  });

  it("keeps the database URL distinct from the API's Project URL", () => {
    // A loose match points the site at Postgres directly, which it cannot speak.
    const tables = [
      "| Project URL | http://127.0.0.1:54321 |",
      "| REST | http://127.0.0.1:54321/rest/v1 |",
      "| URL | postgresql://postgres:postgres@127.0.0.1:54322/postgres |",
    ].join("\n");
    const parsed = parseSupabaseStart(tables);

    expect(parsed.url).toBe("http://127.0.0.1:54321");
    expect(parsed.dbUrl).toBe("postgresql://postgres:postgres@127.0.0.1:54322/postgres");
  });

  it("still reads the older label: value output", () => {
    const classic = [
      "         API URL: http://127.0.0.1:54321",
      "      JWT secret: super-secret-jwt-token",
      "        anon key: eyJhbGci.anon.token",
      "service_role key: eyJhbGci.service.token",
    ].join("\n");
    const parsed = parseSupabaseStart(classic);

    expect(parsed).toMatchObject({
      url: "http://127.0.0.1:54321",
      anon: "eyJhbGci.anon.token",
      service: "eyJhbGci.service.token",
    });
    // Adjacent in the output; a loose match takes the wrong one.
    expect(parsed.anon).not.toContain("super-secret");
  });

  it("reports null rather than guessing when nothing matches", () => {
    expect(parseSupabaseStart("nothing useful here").anon).toBeNull();
  });
});

describe("stripAnsi", () => {
  it("removes colour without touching the text", () => {
    expect(stripAnsi(`${ESC}[1mProject URL${ESC}[0m`)).toBe("Project URL");
  });
});

/**
 * Reading the local stack's connection details.
 *
 * Two attempts at parsing the CLI's pretty output both failed on a real
 * machine: first the right-aligned "label: value" shape I had assumed, then the
 * box-drawing tables it actually prints — whose cells carry ANSI colour codes
 * that survive being captured to a pipe, so an exact label match finds nothing.
 *
 * Parsing a display built for people was the mistake. The CLI has a
 * machine-readable mode (`status --output env`) that emits plain KEY="value"
 * lines with no colour, no layout, and no reason to change between releases.
 * That is the primary path; the table reader is kept only for older CLIs.
 */

const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;]*[A-Za-z]`, "g");

/** Removes terminal colour codes, which otherwise sit inside the labels. */
export function stripAnsi(text) {
  return String(text).replace(ANSI, "");
}

/** Parses `supabase status --output env` — KEY="value" per line. */
export function parseSupabaseEnv(output) {
  const values = new Map();
  for (const line of stripAnsi(output).split("\n")) {
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*"?([^"\r\n]*?)"?\s*$/.exec(line);
    if (match !== null && match[2] !== "") values.set(match[1], match[2]);
  }
  return pick((...names) => {
    for (const name of names) {
      const value = values.get(name);
      if (value !== undefined) return value;
    }
    return null;
  });
}

/**
 * Parses the human-facing output, for CLIs with no --output env.
 *
 * Handles both shapes the CLI has printed. Labels are matched exactly after
 * trimming, which keeps the database's plain `URL` row distinct from the API
 * table's `Project URL` — a loose match points the site at Postgres directly,
 * which it cannot speak.
 */
export function parseSupabaseStart(output) {
  const cells = new Map();

  for (const line of stripAnsi(output).split("\n")) {
    const row = /^\s*[│|]\s*(.+?)\s*[│|]\s*(.+?)\s*[│|]\s*$/.exec(line);
    if (row !== null) {
      if (!cells.has(row[1])) cells.set(row[1], row[2]);
      continue;
    }
    const pair = /^\s*([A-Za-z_][\w ./-]*?)\s*:\s*(\S+)\s*$/.exec(line);
    if (pair !== null && !cells.has(pair[1])) cells.set(pair[1], pair[2]);
  }

  return pick((...labels) => {
    for (const label of labels) {
      const value = cells.get(label);
      if (value !== undefined) return value;
    }
    return null;
  });
}

/** The five things the app needs, however they were labelled. */
function pick(first) {
  return {
    url: first("API_URL", "Project URL", "API URL"),
    anon: first("ANON_KEY", "PUBLISHABLE_KEY", "Publishable", "publishable key", "anon key"),
    service: first("SERVICE_ROLE_KEY", "SECRET_KEY", "Secret", "secret key", "service_role key"),
    dbUrl: first("DB_URL", "URL", "DB URL"),
    studio: first("STUDIO_URL", "Studio", "Studio URL"),
  };
}

/**
 * Building .env from .env.example, kept separate from the asking.
 *
 * Pure so it can be tested: the interactive half needs a terminal, and the part
 * that can silently corrupt a key — pasting into the wrong line, keeping a
 * stray quote, dropping the rest of the template — is all here.
 */

/** Trims, and strips the quotes people copy along with a value. */
export function clean(value) {
  return String(value).trim().replace(/^["']|["']$/g, "");
}

/**
 * Replaces the values of `NAME=` lines, leaving every other line — comments,
 * blank lines, settings not being set — exactly as they were.
 */
export function buildEnv(exampleContents, values) {
  return exampleContents
    .split("\n")
    .map((line) => {
      const match = /^([A-Z0-9_]+)=/.exec(line);
      if (match === null) return line;
      const name = match[1];
      return name in values ? `${name}=${clean(values[name])}` : line;
    })
    .join("\n");
}

/** Things worth saying out loud before they become a confusing error later. */
export function warningsFor({ url, anon, service }) {
  const warnings = [];
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(clean(url))) {
    warnings.push(
      `The Project URL looks unusual: ${clean(url)}\n` +
        `   Expected something like https://abcdefgh.supabase.co`,
    );
  }
  if (clean(anon) !== "" && clean(anon) === clean(service)) {
    warnings.push("The anon key and the service_role key are identical — one was pasted twice.");
  }
  return warnings;
}

/**
 * Reads the keys out of `supabase start` / `supabase status`.
 *
 * Two output shapes, because the CLI changed and both are in the wild:
 *
 *   Older:  `        anon key: eyJhbGci...`     — right-aligned "label: value"
 *   Newer:  `│ Publishable │ sb_publishable_... │` — box-drawing tables
 *
 * The first version of this parser handled only the older shape, and its tests
 * passed because the fixture was written from memory rather than from a real
 * run. On a real machine the CLI printed tables, nothing matched, and it
 * reported "keys could not be read" after a five-minute download. The fixtures
 * below are now copied verbatim from actual output.
 *
 * Labels are matched exactly after trimming, which is what keeps the database's
 * `URL` row distinct from the API table's `Project URL`.
 */
export function parseSupabaseStart(output) {
  /** Every `│ label │ value │` row, and every `label: value` line. */
  const cells = new Map();

  for (const line of output.split("\n")) {
    const row = /^\s*│\s*(.+?)\s*│\s*(.+?)\s*│\s*$/.exec(line);
    if (row !== null) {
      // Header rows ("🔑 Authentication Keys") have no second column and are
      // filtered out by the two-cell shape itself.
      if (!cells.has(row[1])) cells.set(row[1], row[2]);
      continue;
    }
    const pair = /^\s*([A-Za-z_][\w ./-]*?)\s*:\s*(\S+)\s*$/.exec(line);
    if (pair !== null && !cells.has(pair[1])) cells.set(pair[1], pair[2]);
  }

  const first = (...labels) => {
    for (const label of labels) {
      const value = cells.get(label);
      if (value !== undefined) return value;
    }
    return null;
  };

  return {
    url: first("Project URL", "API URL"),
    anon: first("Publishable", "publishable key", "anon key"),
    service: first("Secret", "secret key", "service_role key"),
    dbUrl: first("URL", "DB URL"),
    studio: first("Studio", "Studio URL"),
  };
}

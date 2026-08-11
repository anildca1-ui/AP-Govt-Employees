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
 * Reads the keys out of `supabase start`'s summary.
 *
 * The CLI prints a block of "label: value" lines. Parsing it is what makes the
 * local path a single command instead of "copy these three long strings from
 * the terminal into a file" — which is the same error-prone copying the cloud
 * path has, except the strings are longer.
 *
 * Two naming schemes are accepted because the CLI renamed them: older builds
 * print "anon key" / "service_role key", newer ones "publishable key" /
 * "secret key". Both are recognised so an upgrade does not silently produce an
 * .env with empty keys.
 */
export function parseSupabaseStart(output) {
  const value = (...labels) => {
    for (const label of labels) {
      // Labels are right-aligned with leading spaces, hence the loose start.
      const match = new RegExp(`^\\s*${label}\\s*:\\s*(\\S+)\\s*$`, "im").exec(output);
      if (match !== null) return match[1];
    }
    return null;
  };

  return {
    url: value("API URL"),
    anon: value("anon key", "publishable key"),
    service: value("service_role key", "secret key"),
    dbUrl: value("DB URL"),
    studio: value("Studio URL"),
  };
}

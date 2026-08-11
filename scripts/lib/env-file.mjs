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

/** Reads a .env into a Map, ignoring comments and blank lines. */
export function readEnv(contents) {
  const values = new Map();
  for (const line of String(contents).split("\n")) {
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (match !== null) values.set(match[1], clean(match[2]));
  }
  return values;
}

/**
 * Which of `values` an existing .env is still missing.
 *
 * "Missing" means empty or still holding the template's own default — copying
 * .env.example to .env leaves NEXT_PUBLIC_SUPABASE_URL at 127.0.0.1:54321 and
 * both keys blank, which is a file that exists and does not work.
 *
 * A value already set to something different is NOT missing: that is the
 * owner's cloud project, and overwriting it with a local key would silently
 * point their site at the wrong database.
 */
export function missingFrom(existingContents, exampleContents, values) {
  const existing = readEnv(existingContents);
  const defaults = readEnv(exampleContents);

  return Object.keys(values).filter((name) => {
    const current = existing.get(name);
    if (current === undefined || current === "") return true;
    return current === defaults.get(name) && current !== clean(values[name]);
  });
}

/** Sets only the named keys, leaving every other line untouched. */
export function fillEnv(existingContents, values, names) {
  const wanted = Object.fromEntries(names.map((name) => [name, values[name]]));
  return buildEnv(existingContents, wanted);
}

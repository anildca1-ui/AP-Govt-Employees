import en from "./locales/en.json";
import te from "./locales/te.json";
import type { Locale } from "./config";

/**
 * Telugu is the source of truth for the shape: every other locale must supply
 * exactly the same keys, which dictionary.test.ts enforces. A missing key would
 * otherwise render as `undefined` in the UI rather than fail the build.
 */
export type Dictionary = typeof te;

const dictionaries: Record<Locale, Dictionary> = { te, en };

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}

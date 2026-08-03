import { describe, expect, it } from "vitest";
import { locales, type Locale } from "./config";
import { getDictionary } from "./dictionary";

function flattenKeys(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object") return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    flattenKeys(child, prefix === "" ? key : `${prefix}.${key}`),
  );
}

describe("locale dictionaries", () => {
  const keysByLocale = new Map<Locale, string[]>(
    locales.map((locale) => [locale, flattenKeys(getDictionary(locale)).sort()]),
  );

  it("every locale defines exactly the same keys", () => {
    const [reference, ...rest] = locales;
    const referenceKeys = keysByLocale.get(reference) ?? [];

    for (const locale of rest) {
      const localeKeys = keysByLocale.get(locale) ?? [];
      const missing = referenceKeys.filter((k) => !localeKeys.includes(k));
      const extra = localeKeys.filter((k) => !referenceKeys.includes(k));

      expect(missing, `${locale}.json is missing keys present in ${reference}.json`).toEqual([]);
      expect(extra, `${locale}.json has keys absent from ${reference}.json`).toEqual([]);
    }
  });

  it("no string is left empty", () => {
    for (const locale of locales) {
      const dict = getDictionary(locale) as unknown as Record<string, unknown>;
      const empties = flattenKeys(dict).filter((path) => {
        const value = path
          .split(".")
          .reduce<unknown>((acc, k) => (acc as Record<string, unknown>)?.[k], dict);
        return typeof value === "string" && value.trim() === "";
      });
      expect(empties, `${locale}.json has empty strings`).toEqual([]);
    }
  });

  it("keeps the Telugu UI actually in Telugu", () => {
    // A copy-paste slip that leaves an English string in te.json is invisible in
    // review but obvious to a Telugu-first reader, so assert on the script.
    const te = getDictionary("te");
    const telugu = /[ఀ-౿]/;
    expect(te.nav.gos).toMatch(telugu);
    expect(te.home.heroTitle).toMatch(telugu);
    expect(te.footer.notOfficial).toMatch(telugu);
  });

  it("carries the bilingual disclaimer verbatim in both locales", () => {
    // CLAUDE.md rule 4 — the wording is fixed, and it stays bilingual even in
    // the English UI.
    const expected =
      "ఇది AI సమాచారం మాత్రమే — అధికారిక GO తో సరిచూసుకోండి / AI-generated information only — verify with the original GO before acting.";
    for (const locale of locales) {
      expect(getDictionary(locale).footer.disclaimer).toBe(expected);
    }
  });
});

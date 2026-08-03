export const locales = ["te", "en"] as const;

export type Locale = (typeof locales)[number];

/** Telugu first (CLAUDE.md hard rule 5). English is the toggle, not the default. */
export const defaultLocale: Locale = "te";

export const localeNames: Record<Locale, string> = {
  te: "తెలుగు",
  en: "English",
};

export function isLocale(value: string | undefined): value is Locale {
  return value !== undefined && (locales as readonly string[]).includes(value);
}

/** Cookie remembering the reader's choice, so /  lands them in the right language. */
export const LOCALE_COOKIE = "locale";

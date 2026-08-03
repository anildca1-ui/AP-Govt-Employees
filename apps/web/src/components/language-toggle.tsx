"use client";

import { usePathname, useRouter } from "next/navigation";
import { localeNames, LOCALE_COOKIE, type Locale } from "@/i18n/config";

/**
 * Switches locale by rewriting the first path segment, so the reader stays on
 * the page they were reading instead of being sent back to the home page.
 */
export function LanguageToggle({ locale, label }: { locale: Locale; label: string }) {
  const pathname = usePathname();
  const router = useRouter();

  const next: Locale = locale === "te" ? "en" : "te";

  function switchLocale() {
    // Remembered so an unprefixed URL later resolves to this choice.
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;

    const segments = pathname.split("/");
    segments[1] = next;
    router.push(segments.join("/") || `/${next}`);
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={switchLocale}
      aria-label={label}
      className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 active:bg-slate-200"
    >
      {localeNames[next]}
    </button>
  );
}

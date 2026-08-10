"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { localeNames, LOCALE_COOKIE, type Locale } from "@/i18n/config";

/**
 * Switches locale by rewriting the first path segment, so the reader stays on
 * the page they were reading instead of being sent back to the home page.
 */
export function LanguageToggle(props: { locale: Locale; label: string }) {
  // useSearchParams needs a Suspense boundary on statically rendered pages.
  // The fallback renders the same button, inert for the instant before
  // hydration — better than the whole header popping in late.
  return (
    <Suspense fallback={<ToggleButton {...props} onClick={() => undefined} />}>
      <LanguageToggleInner {...props} />
    </Suspense>
  );
}

function LanguageToggleInner({ locale, label }: { locale: Locale; label: string }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();

  const next: Locale = locale === "te" ? "en" : "te";

  function switchLocale() {
    // Remembered so an unprefixed URL later resolves to this choice.
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;

    const segments = pathname.split("/");
    segments[1] = next;
    // The query string rides along: a dashboard-prefilled calculator
    // (?basicPay=52590) must not lose its numbers because the reader
    // switched language.
    const query = search.toString();
    router.push(`${segments.join("/") || `/${next}`}${query === "" ? "" : `?${query}`}`);
    router.refresh();
  }

  return <ToggleButton locale={locale} label={label} onClick={switchLocale} />;
}

function ToggleButton({
  locale,
  label,
  onClick,
}: {
  locale: Locale;
  label: string;
  onClick: () => void;
}) {
  const next: Locale = locale === "te" ? "en" : "te";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 active:bg-slate-200"
    >
      {localeNames[next]}
    </button>
  );
}

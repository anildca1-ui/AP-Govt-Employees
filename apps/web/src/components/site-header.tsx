import Link from "next/link";
import { LanguageToggle } from "@/components/language-toggle";
import { SiteNav, type NavItem } from "@/components/site-nav";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionary";

export function navItems(locale: Locale, dict: Dictionary): NavItem[] {
  return [
    { href: `/${locale}`, label: dict.nav.home },
    { href: `/${locale}/gos`, label: dict.nav.gos },
    { href: `/${locale}/chat`, label: dict.nav.chat },
    { href: `/${locale}/calculators`, label: dict.nav.calculators },
    { href: `/${locale}/news`, label: dict.nav.news },
    { href: `/${locale}/tests`, label: dict.nav.tests },
    { href: `/${locale}/links`, label: dict.nav.links },
  ];
}

export function SiteHeader({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <Link href={`/${locale}`} className="min-w-0">
          <span className="block truncate text-base font-semibold text-slate-900 sm:text-lg">
            {dict.site.name}
          </span>
          <span className="hidden text-xs text-slate-500 sm:block">{dict.site.tagline}</span>
        </Link>
        {/* Chrome, not content: on paper the toggle is a dead button and the
            nav a row of dead links. The brand line stays — a printout should
            say where it came from. */}
        <div className="print:hidden">
          <LanguageToggle locale={locale} label={dict.lang.switchTo} />
        </div>
      </div>
      <div className="print:hidden">
        <SiteNav items={navItems(locale, dict)} locale={locale} ariaLabel={dict.nav.primary} />
      </div>
    </header>
  );
}

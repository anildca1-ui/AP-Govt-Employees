import type { Metadata, Viewport } from "next";
import { Noto_Sans, Noto_Sans_Telugu } from "next/font/google";
import { notFound } from "next/navigation";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { isLocale, locales } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionary";
import "../globals.css";

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

/**
 * Self-hosted at build time, so a Telugu-first UI does not depend on the reader's
 * device having a Telugu face installed — without this, a phone missing one
 * renders the entire interface as tofu boxes. Latin falls back to Noto Sans so
 * the two scripts sit together evenly.
 */
const telugu = Noto_Sans_Telugu({
  subsets: ["telugu"],
  display: "swap",
  variable: "--font-telugu",
});

const latin = Noto_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-latin",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f172a",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const dict = getDictionary(locale);

  return {
    title: {
      default: dict.site.name,
      template: `%s · ${dict.site.name}`,
    },
    description: dict.site.description,
    applicationName: dict.site.name,
    manifest: "/manifest.webmanifest",
    alternates: {
      canonical: `/${locale}`,
      languages: Object.fromEntries(locales.map((l) => [l, `/${l}`])),
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const dict = getDictionary(locale);

  return (
    <html lang={locale} className={`${telugu.variable} ${latin.variable}`}>
      {/*
        Browser extensions add attributes to <body> before React hydrates —
        Grammarly writes data-gr-ext-installed, password managers and
        translators do the same. React sees the server's HTML and the browser's
        HTML disagree and warns, on every page load, in development.

        Nothing is wrong and no visitor is affected; the extension runs on the
        reader's own machine. But a warning that is always there is a warning
        nobody reads, and this is the same overlay that would report a real
        hydration bug. Suppressing it here covers this element's own attributes
        only — a genuine mismatch in the header, the calculators or anywhere
        else still reports normally.
      */}
      <body
        suppressHydrationWarning
        className="flex min-h-dvh flex-col bg-white text-slate-900 antialiased"
      >
        <SiteHeader locale={locale} dict={dict} />
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
        <SiteFooter locale={locale} dict={dict} />
      </body>
    </html>
  );
}

import { NextResponse, type NextRequest } from "next/server";
import { defaultLocale, isLocale, locales, LOCALE_COOKIE } from "@/i18n/config";

/**
 * Every page lives under a locale prefix (/te/..., /en/...) rather than behind a
 * cookie on a single URL. Telugu and English content then have distinct,
 * indexable addresses — which is what Phase 6's SEO work needs, and retrofitting
 * it after Phase 5 adds the library, news and tests routes would be expensive.
 *
 * A visitor landing on an unprefixed path is redirected to the language they
 * last chose, defaulting to Telugu.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const hasLocalePrefix = locales.some(
    (locale) => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`),
  );
  if (hasLocalePrefix) return NextResponse.next();

  const remembered = request.cookies.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(remembered) ? remembered : defaultLocale;

  const url = request.nextUrl.clone();
  url.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Skip Next internals, API routes, and anything with a file extension
  // (manifest.webmanifest, icons, images).
  matcher: ["/((?!_next|api|.*\\..*).*)"],
};

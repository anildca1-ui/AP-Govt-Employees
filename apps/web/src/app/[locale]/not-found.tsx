import Link from "next/link";
import { getDictionary } from "@/i18n/dictionary";

/**
 * 404 (PLAN.md Part 5, checkpoint 4).
 *
 * It lives inside [locale] rather than at the app root so it renders through
 * the locale layout and carries the header and — the part the checkpoint is
 * actually about — the "not an official Government of AP website" footer. Next's
 * built-in 404 renders outside every layout, which left the one page a confused
 * visitor is most likely to reach as the one page not saying whose site this is.
 *
 * Bilingual, like /privacy and /disclaimer: a not-found.tsx receives no route
 * params, so the locale that framed the request is not knowable here. Showing
 * both is honest; guessing would show Telugu text to a reader who chose English.
 *
 * The links below are deliberately unprefixed. Middleware redirects an
 * unprefixed path to the locale the visitor last chose, so a reader on /en
 * stays in English without this page having to know that.
 */
export default function NotFound() {
  const te = getDictionary("te").notFoundPage;
  const en = getDictionary("en").notFoundPage;

  const destinations = [
    { href: "/gos", te: te.searchGos, en: en.searchGos },
    { href: "/calculators", te: te.calculators, en: en.calculators },
    { href: "/chat", te: te.chat, en: en.chat },
    { href: "/", te: te.home, en: en.home },
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-8 py-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{te.title}</h1>
        <p className="text-sm leading-relaxed text-slate-600">{te.body}</p>
      </section>

      <section className="space-y-2 border-t border-slate-200 pt-6">
        <h2 className="text-xl font-semibold tracking-tight">{en.title}</h2>
        <p className="text-sm leading-relaxed text-slate-600">{en.body}</p>
      </section>

      <nav aria-label={en.tryTitle} className="space-y-3 border-t border-slate-200 pt-6">
        <h3 className="text-sm font-medium text-slate-700">
          {te.tryTitle} / {en.tryTitle}
        </h3>
        <ul className="space-y-2 text-sm">
          {destinations.map((d) => (
            <li key={d.href}>
              <Link href={d.href} className="text-blue-700 underline hover:text-blue-900">
                {d.te} <span className="text-slate-500">/ {d.en}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionary";

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);

  /**
   * The launch wedge from PLAN.md Part 6: GO search, chat and DA arrears are the
   * three things that already beat every reference site.
   *
   * These carried a "coming soon" badge from the Phase 0 placeholder and kept it
   * long after the features were finished, so the front page — the first thing
   * anyone sees — advertised a working portal as unavailable. Status is now
   * stated per card, and every card is a link, because a card describing a
   * feature you cannot click is a poster, not a homepage.
   */
  const cards = [
    {
      href: `/${locale}/gos`,
      title: dict.home.cards.gosTitle,
      body: dict.home.cards.gosBody,
      // Honest: the library exists and is searchable, but it is empty until
      // Government Orders have been approved into it.
      status: dict.home.needsGos,
      live: false,
    },
    {
      href: `/${locale}/chat`,
      title: dict.home.cards.chatTitle,
      body: dict.home.cards.chatBody,
      status: dict.home.needsGos,
      live: false,
    },
    {
      href: `/${locale}/calculators/da-arrears`,
      title: dict.home.cards.daTitle,
      body: dict.home.cards.daBody,
      status: dict.home.liveNow,
      live: true,
    },
  ];

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {dict.home.heroTitle}
        </h1>
        <p className="text-slate-600">{dict.home.heroSubtitle}</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium tracking-wide text-slate-500 uppercase">
          {dict.home.wedgeTitle}
        </h2>
        <ul className="grid gap-3 sm:grid-cols-3">
          {cards.map((card) => (
            <li key={card.title}>
              <Link
                href={card.href}
                className="flex h-full flex-col rounded-lg border border-slate-200 p-4 transition hover:border-slate-400 hover:bg-slate-50"
              >
                <h3 className="font-medium">{card.title}</h3>
                <p className="mt-1 grow text-sm text-slate-600">{card.body}</p>
                <span
                  className={`mt-3 inline-block self-start rounded px-2 py-0.5 text-xs ${
                    card.live
                      ? "bg-emerald-50 text-emerald-800"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {card.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2 border-t border-slate-200 pt-6">
        <Link
          href={`/${locale}/calculators`}
          className="text-sm font-medium text-blue-700 underline hover:text-blue-900"
        >
          {dict.home.allCalculators}
        </Link>
        <p className="text-xs text-slate-500">{dict.home.noSetupNote}</p>
      </section>
    </div>
  );
}

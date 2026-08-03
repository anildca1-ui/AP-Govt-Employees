import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionary";
import { notFound } from "next/navigation";

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);

  // The launch wedge from PLAN.md Part 6: GO search, chat and DA arrears are the
  // three things that already beat every reference site.
  const cards = [
    { title: dict.home.cards.gosTitle, body: dict.home.cards.gosBody },
    { title: dict.home.cards.chatTitle, body: dict.home.cards.chatBody },
    { title: dict.home.cards.daTitle, body: dict.home.cards.daBody },
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
            <li
              key={card.title}
              className="rounded-lg border border-slate-200 p-4 transition hover:border-slate-300"
            >
              <h3 className="font-medium">{card.title}</h3>
              <p className="mt-1 text-sm text-slate-600">{card.body}</p>
              <p className="mt-3 inline-block rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                {dict.common.comingSoon}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

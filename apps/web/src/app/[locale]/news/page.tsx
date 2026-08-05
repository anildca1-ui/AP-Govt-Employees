import Link from "next/link";
import { notFound } from "next/navigation";
import { GoCard } from "@/components/library/go-card";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionary";
import { fetchRecent, publicClient } from "@/lib/library/queries";
import { filterByTag, NEWS_TAGS, type NewsTag } from "@/lib/library/tagging";

/**
 * The news feed (PLAN.md Phase 5).
 *
 * "What is new here", ordered by when we approved a document rather than by the
 * GO's own date — a 2019 order approved this morning is news to a reader who
 * could not find it yesterday.
 *
 * The plan calls for AI summaries. The subject line of a GO is already a
 * one-sentence summary written by the department that issued it, so
 * paraphrasing it through a model would add cost and a chance of drift to
 * replace an authoritative sentence with a synthetic one. Tags are what
 * actually help someone scan the feed, and those are deterministic.
 */

export const dynamic = "force-dynamic";

export default async function NewsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tag?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  const { tag } = await searchParams;

  const selected = NEWS_TAGS.includes(tag as NewsTag) ? (tag as NewsTag) : null;

  const db = publicClient();
  const recent = db === null ? [] : await fetchRecent(db, 50);
  const shown = filterByTag(recent, selected);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{dict.news.title}</h1>
        <p className="text-sm text-slate-600">{dict.news.intro}</p>
      </header>

      <nav className="flex flex-wrap gap-2">
        <Link
          href={`/${locale}/news`}
          className={
            selected === null
              ? "rounded-md bg-slate-900 px-3 py-1 text-sm text-white"
              : "rounded-md border border-slate-300 px-3 py-1 text-sm"
          }
        >
          {dict.news.all}
        </Link>
        {NEWS_TAGS.map((name) => (
          <Link
            key={name}
            href={`/${locale}/news?tag=${name}`}
            className={
              selected === name
                ? "rounded-md bg-slate-900 px-3 py-1 text-sm text-white"
                : "rounded-md border border-slate-300 px-3 py-1 text-sm"
            }
          >
            {/* The tag itself stays the English identifier because it is the URL
                and the value stored against a document; only its label is
                translated. */}
            {dict.news.tags[name]}
          </Link>
        ))}
      </nav>

      {shown.length === 0 ? (
        <p className="rounded-lg border border-slate-200 p-6 text-sm text-slate-600">
          {dict.news.noNews}
        </p>
      ) : (
        <ul className="space-y-2">
          {shown.map((document) => (
            <GoCard key={document.id} document={document} locale={locale} dict={dict} />
          ))}
        </ul>
      )}
    </div>
  );
}

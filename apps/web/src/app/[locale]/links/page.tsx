import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionary";
import { LINK_CATEGORIES } from "@/lib/library/links";

/** The categorised quick-links directory (PLAN.md Phase 5). */
export default async function LinksPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{dict.links.title}</h1>
        <p className="text-sm text-slate-600">{dict.links.intro}</p>
      </header>

      {LINK_CATEGORIES.map((category) => (
        <section key={category.id} className="space-y-3">
          <h2 className="text-sm font-medium tracking-wide text-slate-500 uppercase">
            {category.label}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {category.links.map((link) => (
              <li key={link.url}>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block h-full rounded-lg border border-slate-200 p-4 transition hover:border-slate-300"
                >
                  <h3 className="font-medium">{link.label}</h3>
                  {/* What the site is for, not just its name — the improvement
                      over a flat list of bare links. */}
                  <p className="mt-1 text-sm text-slate-600">{link.purpose}</p>
                  <p className="mt-1 truncate text-xs text-slate-400">{link.url}</p>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { GoCard } from "@/components/library/go-card";
import { isLocale } from "@/i18n/config";
import { getDictionary, type Dictionary } from "@/i18n/dictionary";
import { fetchDepartments, fetchLibraryPage, LIBRARY_PAGE_SIZE, publicClient } from "@/lib/library/queries";

/**
 * The GO library (PLAN.md Phase 5).
 *
 * Filters live in the URL and are applied on the server rather than held in
 * client state. A filtered view is exactly the thing an employee wants to send
 * a colleague on WhatsApp, and that only works if it has an address — and it
 * renders without JavaScript, which matters on the connections this audience
 * actually has.
 */

export const dynamic = "force-dynamic";

interface SearchParams {
  q?: string;
  dept?: string;
  type?: string;
  from?: string;
  to?: string;
  page?: string;
}

export default async function GosPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  const filters = await searchParams;

  const db = publicClient();
  if (db === null) {
    return (
      <Shell dict={dict}>
        <p className="text-sm text-slate-500">{dict.gos.notConnected}</p>
      </Shell>
    );
  }

  const page = Math.max(1, Number(filters.page ?? "1") || 1);
  const offset = (page - 1) * LIBRARY_PAGE_SIZE;

  const [result, departments] = await Promise.all([
    fetchLibraryPage(db, {
      ...(filters.q !== undefined && { q: filters.q }),
      ...(filters.dept ? { dept: filters.dept } : {}),
      ...(filters.type ? { goType: filters.type } : {}),
      ...(filters.from ? { from: filters.from } : {}),
      ...(filters.to ? { to: filters.to } : {}),
      offset,
    }),
    fetchDepartments(db),
  ]);

  const carried = Object.entries(filters).filter(
    ([key, value]) => key !== "page" && typeof value === "string" && value !== "",
  ) as [string, string][];

  const pageHref = (n: number) =>
    `/${locale}/gos?${new URLSearchParams([...carried, ["page", String(n)]])}`;

  return (
    <Shell dict={dict}>
      {/* GET, so the filter state ends up in the URL and stays shareable. */}
      <form
        method="get"
        className="grid gap-3 rounded-lg border border-slate-200 p-4 sm:grid-cols-2"
      >
        <label className="block text-sm sm:col-span-2">
          <span className="mb-1 block text-slate-700">{dict.gos.search}</span>
          <input
            type="search"
            name="q"
            defaultValue={filters.q ?? ""}
            className="w-full rounded-md border border-slate-300 px-3 py-2"
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-slate-700">{dict.gos.dept}</span>
          <select
            name="dept"
            defaultValue={filters.dept ?? ""}
            className="w-full rounded-md border border-slate-300 px-3 py-2"
          >
            <option value="">{dict.gos.allDepts}</option>
            {departments.map((dept) => (
              <option key={dept} value={dept}>
                {dept}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-slate-700">{dict.gos.type}</span>
          <select
            name="type"
            defaultValue={filters.type ?? ""}
            className="w-full rounded-md border border-slate-300 px-3 py-2"
          >
            <option value="">{dict.gos.allTypes}</option>
            {["Ms", "Rt", "Memo", "Circular"].map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-slate-700">{dict.gos.from}</span>
          <input
            type="date"
            name="from"
            defaultValue={filters.from ?? ""}
            className="w-full rounded-md border border-slate-300 px-3 py-2"
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-slate-700">{dict.gos.to}</span>
          <input
            type="date"
            name="to"
            defaultValue={filters.to ?? ""}
            className="w-full rounded-md border border-slate-300 px-3 py-2"
          />
        </label>

        <div className="flex gap-2 sm:col-span-2">
          <button
            type="submit"
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          >
            {dict.gos.apply}
          </button>
          <Link
            href={`/${locale}/gos`}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm"
          >
            {dict.gos.clear}
          </Link>
        </div>
      </form>

      <p className="text-sm text-slate-600">
        {dict.gos.results}: {result.total}
      </p>

      {result.documents.length === 0 ? (
        <p className="rounded-lg border border-slate-200 p-6 text-sm text-slate-600">
          {result.total === 0 && carried.length === 0 ? dict.gos.empty : dict.gos.noResults}
        </p>
      ) : (
        <ul className="space-y-2">
          {result.documents.map((document) => (
            <GoCard key={document.id} document={document} locale={locale} dict={dict} />
          ))}
        </ul>
      )}

      {/* Paged by link rather than infinite scroll: every page has an address,
          works without JavaScript, and can be linked to from search results. */}
      <nav className="flex justify-between text-sm">
        {page > 1 ? (
          <Link href={pageHref(page - 1)} className="underline">
            ←
          </Link>
        ) : (
          <span />
        )}
        {result.hasMore && (
          <Link href={pageHref(page + 1)} className="underline">
            {dict.gos.loadMore} →
          </Link>
        )}
      </nav>
    </Shell>
  );
}

function Shell({ dict, children }: { dict: Dictionary; children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{dict.gos.title}</h1>
        <p className="text-sm text-slate-600">{dict.gos.intro}</p>
      </header>
      {children}
    </div>
  );
}

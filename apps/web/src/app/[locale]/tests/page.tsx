import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionary";
import { DEPARTMENTAL_TESTS } from "@/lib/library/tests-hub";

/** The departmental tests hub (PLAN.md Phase 5). */
export default async function TestsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{dict.tests.title}</h1>
        <p className="text-sm text-slate-600">{dict.tests.intro}</p>
      </header>

      <ul className="grid gap-3 sm:grid-cols-2">
        {DEPARTMENTAL_TESTS.map((test) => (
          <li key={test.id}>
            <Link
              href={`/${locale}/tests/${test.id}`}
              className="block h-full rounded-lg border border-slate-200 p-4 transition hover:border-slate-300"
            >
              <h2 className="font-medium">{test.title}</h2>
              <p className="mt-1 text-sm text-slate-600">{test.who}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

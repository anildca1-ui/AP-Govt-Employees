import Link from "next/link";
import { notFound } from "next/navigation";
import { QuizClient } from "@/components/library/quiz-client";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionary";
import { DEPARTMENTAL_TESTS, findTest } from "@/lib/library/tests-hub";

export function generateStaticParams() {
  return DEPARTMENTAL_TESTS.map((test) => ({ id: test.id }));
}

export default async function TestDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);

  const test = findTest(id);
  if (test === undefined) notFound();

  return (
    <div className="space-y-6">
      <Link href={`/${locale}/tests`} className="text-sm text-slate-600 underline">
        ← {dict.tests.title}
      </Link>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{test.title}</h1>
        <p className="text-sm text-slate-600">{test.who}</p>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-medium tracking-wide text-slate-500 uppercase">
          {dict.tests.syllabus}
        </h2>
        {test.papers.map((paper) => (
          <div key={paper.code} className="rounded-lg border border-slate-200 p-4">
            <h3 className="font-medium">
              Paper {paper.code} — {paper.title}
            </h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
              {paper.topics.map((topic) => (
                <li key={topic}>{topic}</li>
              ))}
            </ul>
          </div>
        ))}
        {/* The binding syllabus is APPSC's notification, not this outline. */}
        <p className="text-xs text-slate-500">{dict.footer.disclaimer}</p>
      </section>

      <QuizClient testId={test.id} dict={dict} />
    </div>
  );
}

"use client";

import Link from "next/link";
import { getDictionary } from "@/i18n/dictionary";

/**
 * Server-error boundary (PLAN.md Part 5, checkpoint 4).
 *
 * It sits inside [locale] so a failed page still renders through the locale
 * layout, keeping the nav and the "not an official Government of AP website"
 * footer. Next's built-in error screen renders outside every layout: an
 * English-only "Application error: a server-side exception has occurred" with
 * no navigation and no banner — on a Telugu-first site whose whole standing
 * rests on not being mistaken for the government's own.
 *
 * Bilingual for the same reason as not-found.tsx: an error boundary receives no
 * route params, so the locale that framed the request is not knowable here.
 *
 * The calculators are client-side maths over the rates table, so most of the
 * site keeps working when the database does not — worth telling the reader,
 * because a blank error page implies the opposite.
 */
export default function LocaleError({ reset }: { error: Error; reset: () => void }) {
  const te = getDictionary("te").errorPage;
  const en = getDictionary("en").errorPage;

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

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-6">
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          {te.retry} / {en.retry}
        </button>
        <Link href="/calculators" className="text-sm text-blue-700 underline hover:text-blue-900">
          {te.offlineNote} <span className="text-slate-500">/ {en.offlineNote}</span>
        </Link>
      </div>
    </div>
  );
}

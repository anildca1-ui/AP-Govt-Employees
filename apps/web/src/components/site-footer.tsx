import Link from "next/link";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionary";

/**
 * The "not an official website" line is required on every page before launch
 * (PLAN.md Part 5, checkpoint 4), so it lives in the layout rather than being
 * added page by page. The bilingual AI disclaimer (CLAUDE.md rule 4) sits beside
 * it — it stays bilingual even in the English UI.
 */
export function SiteFooter({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  return (
    <footer className="mt-auto border-t border-slate-200 bg-slate-50">
      <div className="mx-auto max-w-5xl space-y-3 px-4 py-6 text-xs leading-relaxed text-slate-600">
        <p className="font-medium text-slate-700">{dict.footer.notOfficial}</p>
        <p>{dict.footer.disclaimer}</p>
        {/*
          inline-block with vertical padding, so each link is at least 24px
          tall (WCAG 2.2 SC 2.5.8). At the footer's 12px type they were 20px —
          under the minimum, on every page, for the two links a reader is most
          likely to want on a phone and least able to hit.
        */}
        <div className="flex gap-4 pt-1">
          <Link
            href={`/${locale}/privacy`}
            className="inline-block py-1 underline hover:text-slate-900"
          >
            {dict.footer.privacy}
          </Link>
          <Link
            href={`/${locale}/disclaimer`}
            className="inline-block py-1 underline hover:text-slate-900"
          >
            {dict.footer.disclaimerLink}
          </Link>
        </div>
      </div>
    </footer>
  );
}

import Link from "next/link";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionary";
import type { DocumentRow } from "@/lib/library/queries";

/** GOs are written and cited dd.mm.yyyy, not ISO. */
export function formatGoDate(isoDate: string | null): string | null {
  if (isoDate === null) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (match === null) return isoDate;
  const [, y, m, d] = match;
  return `${d}.${m}.${y}`;
}

/**
 * One GO in a list.
 *
 * The superseded badge is the most important thing on the card: an employee
 * acting on an order that was replaced two years ago is the failure this
 * library exists to prevent, and they should see it before they click.
 */
export function GoCard({
  document,
  locale,
  dict,
}: {
  document: DocumentRow;
  locale: Locale;
  dict: Dictionary;
}) {
  const subject = locale === "te" ? (document.subject_te ?? document.subject) : document.subject;
  const date = formatGoDate(document.issue_date);

  return (
    <li className="rounded-lg border border-slate-200 p-4 transition hover:border-slate-300">
      <Link href={`/${locale}/gos/${document.id}`} className="block space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{document.go_number ?? "—"}</span>
          {date !== null && <span className="text-sm text-slate-500">dt {date}</span>}
          {document.superseded_by !== null && (
            <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
              {dict.gos.notInForce}
            </span>
          )}
        </div>
        {subject !== null && <p className="text-sm text-slate-700">{subject}</p>}
        {document.dept !== null && <p className="text-xs text-slate-500">{document.dept}</p>}
      </Link>
    </li>
  );
}

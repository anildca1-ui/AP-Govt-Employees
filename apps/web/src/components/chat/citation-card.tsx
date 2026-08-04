import type { Citation } from "@ap-emp-ai/rag";
import type { Dictionary } from "@/i18n/dictionary";

/** GOs are cited dd.mm.yyyy, matching how they are written and read. */
export function formatGoDate(isoDate: string | null): string | null {
  if (isoDate === null) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (match === null) return isoDate;
  const [, year, month, day] = match;
  return `${day}.${month}.${year}`;
}

/**
 * One source behind an answer.
 *
 * The GO number, date and PDF link are all present because rule 1 requires an
 * answer to be checkable — the point of a citation here is that the reader can
 * open the order and confirm it, not that the interface looks sourced.
 */
export function CitationCard({ citation, dict }: { citation: Citation; dict: Dictionary }) {
  const date = formatGoDate(citation.issueDate);

  return (
    <li className="rounded-md border border-slate-200 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{citation.goNumber ?? "—"}</span>
        {date !== null && <span className="text-slate-500">dt {date}</span>}
        {citation.supersededBy !== null && (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
            {dict.chat.supersededBadge}
          </span>
        )}
      </div>
      {citation.subject !== null && (
        <p className="mt-1 line-clamp-2 text-slate-600">{citation.subject}</p>
      )}
      {citation.pdfUrl !== null && (
        <a
          href={citation.pdfUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block text-xs underline"
        >
          {dict.chat.viewPdf}
        </a>
      )}
    </li>
  );
}

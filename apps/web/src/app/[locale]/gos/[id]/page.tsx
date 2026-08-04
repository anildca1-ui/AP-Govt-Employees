import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { formatGoDate } from "@/components/library/go-card";
import { isLocale, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionary";
import {
  fetchDocument,
  fetchSupersessionChain,
  publicClient,
  type DocumentRow,
} from "@/lib/library/queries";
import { tagsFor } from "@/lib/library/tagging";

export const dynamic = "force-dynamic";

/**
 * A single GO.
 *
 * The page answers, in order: is this still in force, what does it say, and
 * where is the original. Supersession comes first because it changes what
 * everything below it means.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale, id } = await params;
  if (!isLocale(locale)) return {};

  const db = publicClient();
  if (db === null) return {};

  const document = await fetchDocument(db, id).catch(() => null);
  if (document === null) return {};

  const subject = locale === "te" ? (document.subject_te ?? document.subject) : document.subject;
  const title = [document.go_number, subject].filter(Boolean).join(" — ");

  return {
    title,
    description: subject ?? undefined,
    // A superseded order should not be what a search engine surfaces first.
    ...(document.superseded_by !== null && { robots: { index: false, follow: true } }),
  };
}

export default async function GoDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);

  const db = publicClient();
  if (db === null) notFound();

  const document = await fetchDocument(db, id);
  if (document === null) notFound();

  const chain = await fetchSupersessionChain(db, document);
  const subject = locale === "te" ? (document.subject_te ?? document.subject) : document.subject;
  const tags = tagsFor(document);

  return (
    <div className="space-y-6">
      <Link href={`/${locale}/gos`} className="text-sm text-slate-600 underline">
        ← {dict.gos.title}
      </Link>

      {/* Before anything else: is this order still in force? */}
      {chain.supersededBy !== null ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="font-medium text-amber-900">{dict.gos.notInForce}</p>
          <p className="mt-1 text-sm text-amber-900">
            {dict.gos.supersededBy}:{" "}
            <Link href={`/${locale}/gos/${chain.supersededBy.id}`} className="underline">
              {chain.supersededBy.go_number ?? chain.supersededBy.id}
            </Link>
            {chain.supersededBy.issue_date !== null &&
              ` (dt ${formatGoDate(chain.supersededBy.issue_date)})`}
          </p>
        </div>
      ) : (
        <p className="text-sm text-green-700">{dict.gos.stillInForce}</p>
      )}

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{document.go_number ?? "—"}</h1>
        {subject !== null && <p className="text-slate-700">{subject}</p>}
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600">
          {document.dept !== null && (
            <div>
              <dt className="inline">{dict.gos.dept}: </dt>
              <dd className="inline font-medium">{document.dept}</dd>
            </div>
          )}
          {document.issue_date !== null && (
            <div>
              <dt className="inline">{dict.gos.issued}: </dt>
              <dd className="inline font-medium">{formatGoDate(document.issue_date)}</dd>
            </div>
          )}
        </dl>
        {tags.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <li key={tag} className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                {tag}
              </li>
            ))}
          </ul>
        )}
      </header>

      <div className="flex flex-wrap gap-2">
        {document.pdf_url !== null && (
          <a
            href={document.pdf_url}
            target="_blank"
            rel="noreferrer"
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          >
            {dict.gos.viewPdf}
          </a>
        )}
        {/* Sends the reader to the chat with the GO number, which takes the
            exact-match retrieval path rather than a similarity search. */}
        <Link
          href={`/${locale}/chat?q=${encodeURIComponent(document.go_number ?? "")}`}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm"
        >
          {dict.gos.askAboutThis}
        </Link>
      </div>

      {chain.supersedes.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium tracking-wide text-slate-500 uppercase">
            {dict.gos.supersedes}
          </h2>
          <ul className="space-y-2">
            {chain.supersedes.map((older) => (
              <ChainLink key={older.id} document={older} locale={locale} />
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-slate-500">{dict.footer.disclaimer}</p>
    </div>
  );
}

function ChainLink({ document, locale }: { document: DocumentRow; locale: Locale }) {
  const subject = locale === "te" ? (document.subject_te ?? document.subject) : document.subject;

  return (
    <li className="rounded border border-slate-200 p-3 text-sm">
      <Link href={`/${locale}/gos/${document.id}`} className="block">
        <span className="font-medium">{document.go_number ?? "—"}</span>
        {document.issue_date !== null && (
          <span className="text-slate-500"> · dt {formatGoDate(document.issue_date)}</span>
        )}
        {subject !== null && <p className="mt-0.5 text-slate-600">{subject}</p>}
      </Link>
    </li>
  );
}

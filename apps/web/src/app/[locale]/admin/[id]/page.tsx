import Link from "next/link";
import { notFound } from "next/navigation";
import { approve, linkSupersession, reject, saveMeta } from "../actions";
import { GO_TYPES, readQueueMeta, type QueueRow } from "@/lib/admin/approve";
import { isAdmin } from "@/lib/admin/auth";
import { createServiceRoleClient } from "@/lib/admin/db";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionary";

export const dynamic = "force-dynamic";

interface DocMatch {
  id: string;
  go_number: string | null;
  issue_date: string | null;
  subject: string | null;
}

export default async function AdminDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ saved?: string; linked?: string; q?: string }>;
}) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  const { saved, linked, q } = await searchParams;

  // Pages are gated as well as actions: without this the row would render to
  // anyone who guessed the URL, even though the actions themselves would refuse.
  if (!(await isAdmin())) notFound();

  const db = createServiceRoleClient();
  const { data, error } = await db.from("ingest_queue").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`ingest_queue read failed: ${error.message}`);
  if (data === null) notFound();

  const row = data as QueueRow;
  const meta = readQueueMeta(row.meta);

  // The supersession linker joins rows in `documents`, so it only has something
  // to link once this queue row has been approved into one.
  const { data: selfDoc } = row.sha256
    ? await db.from("documents").select("id").eq("sha256", row.sha256).maybeSingle()
    : { data: null };
  const approvedDocId = (selfDoc as { id: string } | null)?.id ?? null;

  const search = (q ?? "").trim();
  let matches: DocMatch[] = [];
  if (approvedDocId !== null && search !== "") {
    const { data: found, error: searchError } = await db
      .from("documents")
      .select("id, go_number, issue_date, subject")
      .ilike("go_number", `%${search}%`)
      .neq("id", approvedDocId)
      .limit(10);
    if (searchError) throw new Error(`documents search failed: ${searchError.message}`);
    matches = (found ?? []) as DocMatch[];
  }

  return (
    <div className="space-y-6">
      {/* py-1 keeps both of these at the 24px tap minimum (WCAG 2.2) — the
          reviewer approves GOs from a phone like everyone else. */}
      <Link
        href={`/${locale}/admin`}
        className="inline-block py-1 text-sm text-slate-600 underline"
      >
        ← {dict.admin.backToQueue}
      </Link>

      <header className="space-y-1">
        <h1 className="text-xl font-semibold">{meta.go_number ?? dict.admin.unknown}</h1>
        <p className="text-xs text-slate-500">
          {dict.admin.source}: {row.source} · {dict.admin.status}: {row.status}
          {meta.confidence !== null && ` · ${dict.admin.confidence}: ${meta.confidence.toFixed(2)}`}
        </p>
        {row.raw_url !== null && (
          <a
            href={row.raw_url}
            target="_blank"
            rel="noreferrer"
            className="inline-block py-1 text-sm underline"
          >
            {dict.admin.pdf}
          </a>
        )}
      </header>

      {meta.review_reasons.length > 0 && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h2 className="text-sm font-medium text-amber-900">{dict.admin.reviewReasons}</h2>
          <ul className="mt-1 list-inside list-disc text-sm text-amber-900">
            {meta.review_reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </section>
      )}

      {saved === "1" && <p className="text-sm text-green-700">{dict.admin.saved}</p>}
      {linked === "1" && <p className="text-sm text-green-700">{dict.admin.linked}</p>}

      <form action={saveMeta} className="space-y-3 rounded-lg border border-slate-200 p-4">
        <h2 className="font-medium">{dict.admin.metadata}</h2>
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="id" value={row.id} />

        <Field label={dict.admin.goNumber} name="go_number" value={meta.go_number} />

        <label className="block text-sm">
          <span className="mb-1 block text-slate-700">{dict.admin.goType}</span>
          <select
            name="go_type"
            defaultValue={meta.go_type ?? ""}
            className="w-full rounded-md border border-slate-300 px-3 py-2"
          >
            <option value="">—</option>
            {GO_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>

        <Field label={dict.admin.dept} name="dept" value={meta.dept} />
        <Field
          label={dict.admin.issueDate}
          name="issue_date"
          value={meta.issue_date}
          type="date"
        />
        <Field label={dict.admin.subject} name="subject" value={meta.subject} />
        <Field label={dict.admin.subjectTe} name="subject_te" value={meta.subject_te} />

        <button
          type="submit"
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium"
        >
          {dict.admin.save}
        </button>
      </form>

      <div className="flex gap-3">
        <form action={approve}>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="id" value={row.id} />
          <button
            type="submit"
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          >
            {dict.admin.approve}
          </button>
        </form>
        <form action={reject}>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="id" value={row.id} />
          <button
            type="submit"
            className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700"
          >
            {dict.admin.reject}
          </button>
        </form>
      </div>

      <section className="space-y-3 rounded-lg border border-slate-200 p-4">
        <div>
          <h2 className="font-medium">{dict.admin.supersession}</h2>
          <p className="text-sm text-slate-600">{dict.admin.supersessionHelp}</p>
        </div>

        {approvedDocId === null ? (
          <p className="text-sm text-slate-500">{dict.admin.notApprovedYet}</p>
        ) : (
          <>
            {/* GET so a search is shareable and re-runnable, and never mutates. */}
            <form method="get" className="flex gap-2">
              <input
                type="search"
                name="q"
                defaultValue={search}
                placeholder={dict.admin.searchGo}
                className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <button type="submit" className="rounded-md border border-slate-300 px-3 text-sm">
                {dict.admin.search}
              </button>
            </form>

            {search !== "" && matches.length === 0 && (
              <p className="text-sm text-slate-500">{dict.admin.noResults}</p>
            )}

            <ul className="space-y-2">
              {matches.map((match) => (
                <li
                  key={match.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 p-2"
                >
                  <span className="text-sm">
                    <span className="font-medium">{match.go_number ?? dict.admin.unknown}</span>
                    {match.issue_date !== null && (
                      <span className="text-slate-500"> · {match.issue_date}</span>
                    )}
                  </span>
                  <form action={linkSupersession}>
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="queue_id" value={row.id} />
                    {/* The match is the older GO; this document supersedes it. */}
                    <input type="hidden" name="old_id" value={match.id} />
                    <input type="hidden" name="new_id" value={approvedDocId} />
                    <button
                      type="submit"
                      className="rounded border border-slate-300 px-3 py-1 text-xs"
                    >
                      {dict.admin.linkThis}
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

function Field({
  label,
  name,
  value,
  type = "text",
}: {
  label: string;
  name: string;
  value: string | null;
  type?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-slate-700">{label}</span>
      <input
        type={type}
        name={name}
        defaultValue={value ?? ""}
        className="w-full rounded-md border border-slate-300 px-3 py-2"
      />
    </label>
  );
}

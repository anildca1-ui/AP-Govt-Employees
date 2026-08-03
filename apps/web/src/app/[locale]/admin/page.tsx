import Link from "next/link";
import { login } from "./actions";
import { readQueueMeta, type QueueRow } from "@/lib/admin/approve";
import { isAdmin } from "@/lib/admin/auth";
import { createServiceRoleClient } from "@/lib/admin/db";
import { isLocale, type Locale } from "@/i18n/config";
import { getDictionary, type Dictionary } from "@/i18n/dictionary";
import { notFound } from "next/navigation";

// The queue is operational state, never a cached page.
export const dynamic = "force-dynamic";

export default async function AdminQueuePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ login?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  const { login: loginState } = await searchParams;

  if (!(await isAdmin())) {
    return <SignIn locale={locale} dict={dict} failed={loginState === "failed"} />;
  }

  const db = createServiceRoleClient();
  const { data, error } = await db
    .from("ingest_queue")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) throw new Error(`ingest_queue read failed: ${error.message}`);
  const rows = (data ?? []) as QueueRow[];

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{dict.admin.title}</h1>
        <p className="text-sm text-slate-600">{dict.admin.subtitle}</p>
      </header>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-slate-200 p-6 text-sm text-slate-600">
          {dict.admin.empty}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => {
            const meta = readQueueMeta(row.meta);
            return (
              <li
                key={row.id}
                className="rounded-lg border border-slate-200 p-4 transition hover:border-slate-300"
              >
                <Link href={`/${locale}/admin/${row.id}`} className="block space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {meta.go_number ?? row.raw_url ?? dict.admin.unknown}
                    </span>
                    {meta.needs_review === true && (
                      <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
                        {dict.admin.needsReview}
                      </span>
                    )}
                  </div>
                  {meta.subject !== null && (
                    <p className="line-clamp-2 text-sm text-slate-600">{meta.subject}</p>
                  )}
                  <p className="text-xs text-slate-500">
                    {dict.admin.source}: {row.source} · {dict.admin.received}:{" "}
                    {formatWhen(row.created_at)}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function SignIn({
  locale,
  dict,
  failed,
}: {
  locale: Locale;
  dict: Dictionary;
  failed: boolean;
}) {
  return (
    <form action={login} className="mx-auto max-w-sm space-y-3">
      <h1 className="text-xl font-semibold">{dict.admin.login}</h1>
      <input type="hidden" name="locale" value={locale} />
      <label className="block text-sm">
        <span className="mb-1 block text-slate-700">{dict.admin.token}</span>
        <input
          type="password"
          name="token"
          required
          autoComplete="current-password"
          className="w-full rounded-md border border-slate-300 px-3 py-2"
        />
      </label>
      {failed && <p className="text-sm text-red-700">{dict.admin.loginFailed}</p>}
      <button
        type="submit"
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
      >
        {dict.admin.signIn}
      </button>
    </form>
  );
}

/** Fixed locale/zone: reviewers compare timestamps across rows, not prose. */
function formatWhen(value: string | null): string {
  if (value === null) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toISOString().slice(0, 16).replace("T", " ");
}

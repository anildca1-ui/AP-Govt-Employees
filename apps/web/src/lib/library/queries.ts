import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Reads for the public content modules: the GO library, news and tests.
 *
 * All of them go through the anon key. These pages show only approved
 * documents, and RLS enforces that independently of anything written here —
 * a public page has no business holding a key that bypasses row-level security.
 */

export interface DocumentRow {
  id: string;
  go_number: string | null;
  go_type: string | null;
  dept: string | null;
  issue_date: string | null;
  subject: string | null;
  subject_te: string | null;
  pdf_url: string | null;
  source: string | null;
  superseded_by: string | null;
  supersedes: string[] | null;
  created_at: string;
}

export function publicClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // Null rather than throwing: the library should render an empty state on a
  // site that has not been connected yet, not a 500.
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export interface LibraryFilters {
  /** Free text over subject and GO number. */
  q?: string;
  dept?: string;
  goType?: string;
  /** ISO yyyy-mm-dd bounds. */
  from?: string;
  to?: string;
  /** Page size; the library is browsed in slices, not loaded whole. */
  limit?: number;
  offset?: number;
}

export const LIBRARY_PAGE_SIZE = 20;

export interface LibraryPage {
  documents: DocumentRow[];
  total: number;
  hasMore: boolean;
}

/** Escapes PostgREST's `or` filter syntax, where commas separate conditions. */
export function escapeFilterValue(value: string): string {
  return value.replace(/[,()"\\]/g, " ").trim();
}

export async function fetchLibraryPage(
  db: SupabaseClient,
  filters: LibraryFilters = {},
): Promise<LibraryPage> {
  const limit = filters.limit ?? LIBRARY_PAGE_SIZE;
  const offset = filters.offset ?? 0;

  let query = db
    .from("documents")
    .select("*", { count: "exact" })
    // Redundant with RLS on purpose: if the policy is ever loosened, this page
    // still must not show a pending document.
    .eq("status", "approved")
    .order("issue_date", { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1);

  const text = filters.q === undefined ? "" : escapeFilterValue(filters.q);
  if (text !== "") {
    query = query.or(`subject.ilike.%${text}%,go_number.ilike.%${text}%,dept.ilike.%${text}%`);
  }
  if (filters.dept) query = query.eq("dept", filters.dept);
  if (filters.goType) query = query.eq("go_type", filters.goType);
  if (filters.from) query = query.gte("issue_date", filters.from);
  if (filters.to) query = query.lte("issue_date", filters.to);

  const { data, error, count } = await query;
  if (error) throw new Error(`documents query failed: ${error.message}`);

  const documents = (data ?? []) as DocumentRow[];
  const total = count ?? documents.length;

  return { documents, total, hasMore: offset + documents.length < total };
}

export async function fetchDocument(
  db: SupabaseClient,
  id: string,
): Promise<DocumentRow | null> {
  const { data, error } = await db
    .from("documents")
    .select("*")
    .eq("id", id)
    .eq("status", "approved")
    .maybeSingle();

  if (error) throw new Error(`document query failed: ${error.message}`);
  return (data as DocumentRow | null) ?? null;
}

export interface SupersessionChain {
  /** Older GOs this one replaced, newest first. */
  supersedes: DocumentRow[];
  /** The GO that replaced this one, if any. */
  supersededBy: DocumentRow | null;
}

/**
 * One hop in each direction.
 *
 * Deliberately not the transitive closure: a chain rendered five deep is
 * harder to read than the one fact that matters — is this order still in
 * force, and if not, what replaced it. Following the link again from the next
 * page walks the chain at the reader's pace.
 */
export async function fetchSupersessionChain(
  db: SupabaseClient,
  document: DocumentRow,
): Promise<SupersessionChain> {
  const ids = document.supersedes ?? [];

  const [olderResult, newerResult] = await Promise.all([
    ids.length === 0
      ? Promise.resolve({ data: [], error: null })
      : db.from("documents").select("*").in("id", ids).eq("status", "approved"),
    document.superseded_by === null
      ? Promise.resolve({ data: null, error: null })
      : db
          .from("documents")
          .select("*")
          .eq("id", document.superseded_by)
          .eq("status", "approved")
          .maybeSingle(),
  ]);

  if (olderResult.error) throw new Error(`supersedes query failed: ${olderResult.error.message}`);
  if (newerResult.error) {
    throw new Error(`superseded_by query failed: ${newerResult.error.message}`);
  }

  const supersedes = ((olderResult.data ?? []) as DocumentRow[]).sort((a, b) =>
    (b.issue_date ?? "").localeCompare(a.issue_date ?? ""),
  );

  return { supersedes, supersededBy: (newerResult.data as DocumentRow | null) ?? null };
}

/** Distinct departments, for the filter dropdown. */
export async function fetchDepartments(db: SupabaseClient): Promise<string[]> {
  const { data, error } = await db
    .from("documents")
    .select("dept")
    .eq("status", "approved")
    .not("dept", "is", null)
    .limit(1000);

  if (error) throw new Error(`departments query failed: ${error.message}`);

  const names = new Set<string>();
  for (const row of (data ?? []) as { dept: string | null }[]) {
    if (row.dept !== null && row.dept.trim() !== "") names.add(row.dept);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/** Recently approved documents, for the news feed. */
export async function fetchRecent(db: SupabaseClient, limit = 30): Promise<DocumentRow[]> {
  const { data, error } = await db
    .from("documents")
    .select("*")
    .eq("status", "approved")
    // Ordered by when we approved it, not the GO's own date: the feed is
    // "what is new here", and a GO from 2019 approved today is news to us.
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`recent documents query failed: ${error.message}`);
  return (data ?? []) as DocumentRow[];
}

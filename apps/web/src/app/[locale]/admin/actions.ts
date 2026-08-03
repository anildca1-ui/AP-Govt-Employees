"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { defaultLocale, isLocale, type Locale } from "@/i18n/config";
import {
  asGoType,
  asIsoDate,
  queueRowToDocument,
  type QueueRow,
} from "@/lib/admin/approve";
import { establishAdminSession, requireAdmin } from "@/lib/admin/auth";
import { createServiceRoleClient } from "@/lib/admin/db";

/**
 * Server actions behind /admin. Plain-form friendly on purpose: every action
 * takes FormData and finishes with a redirect, so the review queue works with
 * zero client JavaScript (progressive enhancement, nothing to hydrate).
 * Every mutating action re-checks requireAdmin() — the cookie gates the pages,
 * but actions are addressable endpoints of their own.
 */

function fieldText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** Empty form fields mean "unknown", which the schema spells null. */
function nullable(value: string): string | null {
  return value === "" ? null : value;
}

// The locale rides along in a hidden field so redirects land back in the
// language the reviewer was working in.
function formLocale(form: FormData): Locale {
  const value = fieldText(form, "locale");
  return isLocale(value) ? value : defaultLocale;
}

function requiredId(form: FormData, name: string): string {
  const value = fieldText(form, name);
  if (value === "") throw new Error(`admin action: missing ${name}`);
  return value;
}

async function fetchQueueRow(id: string): Promise<QueueRow> {
  const db = createServiceRoleClient();
  const { data, error } = await db.from("ingest_queue").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`ingest_queue read failed: ${error.message}`);
  if (data === null) throw new Error(`queue row ${id} not found`);
  return data as QueueRow;
}

export async function login(formData: FormData): Promise<void> {
  const locale = formLocale(formData);
  const ok = await establishAdminSession(fieldText(formData, "token"));
  // Failure goes back through a query param, not a thrown error: a typo in the
  // token should re-render the form with a message, never a 500 page.
  redirect(ok ? `/${locale}/admin` : `/${locale}/admin?login=failed`);
}

export async function saveMeta(formData: FormData): Promise<void> {
  await requireAdmin();
  const locale = formLocale(formData);
  const id = requiredId(formData, "id");
  const row = await fetchQueueRow(id);

  // Merge over the stored meta so extractor bookkeeping the form does not show
  // (bytes, confidence, needs_review, review_reasons, supersedes) survives an
  // admin edit of the visible fields.
  const existing =
    row.meta !== null && typeof row.meta === "object" && !Array.isArray(row.meta)
      ? (row.meta as Record<string, unknown>)
      : {};
  const meta = {
    ...existing,
    go_number: nullable(fieldText(formData, "go_number")),
    go_type: asGoType(fieldText(formData, "go_type")),
    dept: nullable(fieldText(formData, "dept")),
    issue_date: asIsoDate(fieldText(formData, "issue_date")),
    subject: nullable(fieldText(formData, "subject")),
    subject_te: nullable(fieldText(formData, "subject_te")),
  };

  const db = createServiceRoleClient();
  const { error } = await db.from("ingest_queue").update({ meta }).eq("id", id);
  if (error) throw new Error(`ingest_queue meta update failed: ${error.message}`);

  revalidatePath(`/${locale}/admin`);
  revalidatePath(`/${locale}/admin/${id}`);
  redirect(`/${locale}/admin/${id}?saved=1`);
}

export async function approve(formData: FormData): Promise<void> {
  await requireAdmin();
  const locale = formLocale(formData);
  const id = requiredId(formData, "id");
  const row = await fetchQueueRow(id);
  const payload = queueRowToDocument(row);

  const db = createServiceRoleClient();
  const { error: insertError } = await db.from("documents").insert(payload);
  if (insertError !== null && insertError.code !== "23505") {
    throw new Error(`documents insert failed: ${insertError.message}`);
  }
  // 23505 on documents.sha256 means the same bytes were approved earlier from
  // another source. That resolves this row — mark it duplicate, don't fail it.
  const status = insertError === null ? "done" : "duplicate";

  const { error: statusError } = await db.from("ingest_queue").update({ status }).eq("id", id);
  if (statusError) throw new Error(`ingest_queue status update failed: ${statusError.message}`);

  revalidatePath(`/${locale}/admin`);
  revalidatePath(`/${locale}/admin/${id}`);
  redirect(`/${locale}/admin/${id}`);
}

export async function reject(formData: FormData): Promise<void> {
  await requireAdmin();
  const locale = formLocale(formData);
  const id = requiredId(formData, "id");

  // The schema has no 'rejected' queue status; 'failed' plus a fixed error
  // string is the agreed encoding, and it keeps the row out of every retry.
  const db = createServiceRoleClient();
  const { error } = await db
    .from("ingest_queue")
    .update({ status: "failed", error: "rejected by admin" })
    .eq("id", id);
  if (error) throw new Error(`ingest_queue reject failed: ${error.message}`);

  revalidatePath(`/${locale}/admin`);
  revalidatePath(`/${locale}/admin/${id}`);
  redirect(`/${locale}/admin`);
}

export async function linkSupersession(formData: FormData): Promise<void> {
  await requireAdmin();
  const locale = formLocale(formData);
  const queueId = requiredId(formData, "queue_id");
  const oldId = requiredId(formData, "old_id");
  const newId = requiredId(formData, "new_id");
  // Mirrors the schema's not-self check constraint, but caught here with a
  // readable message instead of a constraint violation.
  if (oldId === newId) throw new Error("a GO cannot supersede itself");

  const db = createServiceRoleClient();
  const { data: newDoc, error: readError } = await db
    .from("documents")
    .select("supersedes")
    .eq("id", newId)
    .maybeSingle();
  if (readError) throw new Error(`documents read failed: ${readError.message}`);
  if (newDoc === null) throw new Error(`document ${newId} not found`);

  // Two updates, not one transaction — PostgREST offers no multi-statement tx
  // without an RPC. superseded_by goes first because the RAG answer path walks
  // that column (CLAUDE.md rule 3); supersedes[] is display-side breadcrumbing.
  const { data: oldRows, error: oldError } = await db
    .from("documents")
    .update({ superseded_by: newId })
    .eq("id", oldId)
    .select("id");
  if (oldError) throw new Error(`superseded_by update failed: ${oldError.message}`);
  if (oldRows === null || oldRows.length === 0) throw new Error(`document ${oldId} not found`);

  const supersedes = Array.isArray(newDoc.supersedes) ? (newDoc.supersedes as string[]) : [];
  if (!supersedes.includes(oldId)) {
    const { error: newError } = await db
      .from("documents")
      .update({ supersedes: [...supersedes, oldId] })
      .eq("id", newId);
    if (newError) throw new Error(`supersedes update failed: ${newError.message}`);
  }

  revalidatePath(`/${locale}/admin/${queueId}`);
  // The public library renders supersession chains from these columns.
  revalidatePath(`/${locale}/gos`);
  redirect(`/${locale}/admin/${queueId}?linked=1`);
}

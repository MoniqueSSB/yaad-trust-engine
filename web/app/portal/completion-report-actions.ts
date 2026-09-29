"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { notesFromText } from "@/lib/portal/completion-report";
import { scrub } from "@/lib/scrub";

/**
 * The worker's signature and the client's review of the Completion Report.
 *
 * Thin on purpose, the same shape as the walkthrough actions: the rules live
 * in Postgres (sign_completion_report, confirm_completion_report,
 * flag_completion_report, 20260928200000), so a bug here is a refusal, never a
 * signature nobody gave. Each returns the database's own words when it
 * refuses, so the person reads which rule fired.
 */

export type ReportActionState = { ok?: boolean; error?: string; changed?: boolean };

/* The worker's three acts, 28 Sep 2026 (20260928233000): change the words,
 * sign, or raise an issue. No login: the code in the WhatsApp link is the
 * key, checked in Postgres, where ten wrong codes lock the link. The same
 * actions serve the portal page, which carries the same code. */
async function byCode(fn: string, args: Record<string, unknown>): Promise<ReportActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { error: error.message };
  const r = (data ?? {}) as { ok?: boolean; error?: string; changed?: boolean };
  if (r.error) return { error: r.error };
  return { ok: true, changed: Boolean(r.changed) };
}

function wordsFrom(formData: FormData) {
  return {
    p_job: String(formData.get("jobId") ?? ""),
    p_code: String(formData.get("code") ?? ""),
    p_care_notes: notesFromText(String(formData.get("careNotes") ?? "")),
    p_worker_account: String(formData.get("account") ?? ""),
  };
}

function refresh(jobId: string) {
  revalidatePath("/report/" + jobId);
  revalidatePath("/portal/jobs/" + jobId + "/completion");
}

export async function saveCompletionWords(_prev: ReportActionState, formData: FormData): Promise<ReportActionState> {
  const args = wordsFrom(formData);
  const r = await byCode("edit_completion_report_by_code", args);
  if (r.ok) refresh(args.p_job);
  return r;
}

export async function signCompletionReport(_prev: ReportActionState, formData: FormData): Promise<ReportActionState> {
  const args = wordsFrom(formData);
  const r = await byCode("sign_completion_report_by_code", args);
  if (r.ok) refresh(args.p_job);
  return r;
}

export async function raiseCompletionIssue(_prev: ReportActionState, formData: FormData): Promise<ReportActionState> {
  const jobId = String(formData.get("jobId") ?? "");
  const r = await byCode("raise_completion_issue_by_code", {
    p_job: jobId,
    p_code: String(formData.get("code") ?? ""),
    // Scrubbed of contact details, the same as any dispute text.
    p_body: scrub(String(formData.get("issue") ?? "").trim().slice(0, 1500)).clean,
  });
  if (r.ok) refresh(jobId);
  return r;
}

export async function confirmCompletionReport(_prev: ReportActionState, formData: FormData): Promise<ReportActionState> {
  await requireUser();
  const jobId = String(formData.get("jobId") ?? "");
  if (!jobId) return { error: "Which job is this?" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("confirm_completion_report", { p_job: jobId });
  if (error) return { error: error.message };
  revalidatePath("/portal/jobs/" + jobId + "/completion");
  return { ok: true };
}

export async function flagCompletionReport(_prev: ReportActionState, formData: FormData): Promise<ReportActionState> {
  await requireUser();
  const jobId = String(formData.get("jobId") ?? "");
  if (!jobId) return { error: "Which job is this?" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("flag_completion_report", {
    p_job: jobId,
    // Scrubbed of contact details before it becomes a dispute the worker
    // reads, exactly as raiseDispute does for any other dispute.
    p_body: scrub(String(formData.get("body") ?? "").trim().slice(0, 1900)).clean,
  });
  if (error) return { error: error.message };
  revalidatePath("/portal/jobs/" + jobId + "/completion");
  return { ok: true };
}

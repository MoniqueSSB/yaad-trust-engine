"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { notesFromText } from "@/lib/portal/completion-report";

/**
 * The worker's signature and the client's review of the Completion Report.
 *
 * Thin on purpose, the same shape as the walkthrough actions: the rules live
 * in Postgres (sign_completion_report, confirm_completion_report,
 * flag_completion_report, 20260928160000), so a bug here is a refusal, never a
 * signature nobody gave. Each returns the database's own words when it
 * refuses, so the person reads which rule fired.
 */

export type ReportActionState = { ok?: boolean; error?: string; changed?: boolean };

export async function signCompletionReport(_prev: ReportActionState, formData: FormData): Promise<ReportActionState> {
  await requireUser();
  const jobId = String(formData.get("jobId") ?? "");
  if (!jobId) return { error: "Which job is this?" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sign_completion_report", {
    p_job: jobId,
    p_code: String(formData.get("code") ?? ""),
    p_name: String(formData.get("name") ?? ""),
    p_care_notes: notesFromText(String(formData.get("careNotes") ?? "")),
    p_worker_account: String(formData.get("account") ?? ""),
  });
  if (error) return { error: error.message };
  revalidatePath("/portal/jobs/" + jobId + "/completion");
  const row = Array.isArray(data) ? data[0] : data;
  return { ok: true, changed: Boolean(row?.worker_did_change) };
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
    p_body: String(formData.get("body") ?? ""),
  });
  if (error) return { error: error.message };
  revalidatePath("/portal/jobs/" + jobId + "/completion");
  return { ok: true };
}

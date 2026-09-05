"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Quote submission. Thin on purpose: jq_insert_vetted in Postgres is the
 * gate (published profile + signed Worker Guidelines + genuinely open job),
 * so a bug here is a refusal message, not an unvetted quote.
 */
export async function submitQuote(formData: FormData): Promise<void> {
  const user = await requireUser();
  const jobId = String(formData.get("jobId") ?? "");
  const labour = parseInt(String(formData.get("labour") ?? ""), 10);
  const materials = parseInt(String(formData.get("materials") ?? "0"), 10) || 0;
  const start = String(formData.get("start") ?? "");
  const days = String(formData.get("days") ?? "");
  const note = String(formData.get("note") ?? "");
  const scopeSummary = String(formData.get("scopeSummary") ?? "").trim() || null;
  const includedNote = String(formData.get("includedNote") ?? "").trim() || null;
  const excludedNote = String(formData.get("excludedNote") ?? "").trim() || null;
  const timelineNote = String(formData.get("timelineNote") ?? "").trim() || null;
  const paymentStageNote = String(formData.get("paymentStageNote") ?? "").trim() || null;
  if (!jobId || !Number.isFinite(labour) || labour <= 0) return;

  const supabase = await createClient();
  const email = (user.email ?? "").toLowerCase();
  const { data: profile } = await supabase
    .from("worker_profiles")
    .select("name")
    .eq("worker_email", email)
    .maybeSingle();

  await supabase.from("job_quotes").insert({
    job_id: jobId,
    worker_user: user.id,
    worker_email: email,
    worker_name: profile?.name ?? email,
    labour_jmd: labour,
    materials_jmd: materials,
    materials_at_cost: true,
    earliest_start: start,
    days_estimate: days,
    note,
    scope_summary: scopeSummary,
    included_note: includedNote,
    excluded_note: excludedNote,
    timeline_note: timelineNote,
    payment_stage_note: paymentStageNote,
    status: "submitted",
  });

  /* Telling the client a price has landed is now a database trigger
     (notify_client_quote_arrived, fired on this same insert), not something
     the UI asks for. That is deliberate: the state change is the trigger,
     never the click. See 20260831i_notify_client_from_the_state_change.sql. */

  revalidatePath("/jobs");
}

/**
 * The requested worker passes on a job they were asked for by name.
 *
 * Thin, same as submitQuote above: worker_decline_job_request in Postgres is
 * the gate. It matches the request against the caller's own JWT email, so a
 * job id on its own decides nothing and this file cannot decline somebody
 * else's request even if it tried.
 *
 * Declining opens the job to the board immediately. That is the point: the
 * client asked for one person, and the fastest honest answer to "they cannot"
 * is the other quotes.
 */
export async function declineJobRequest(formData: FormData): Promise<void> {
  await requireUser();
  const jobId = String(formData.get("jobId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 200);
  if (!jobId) return;

  const supabase = await createClient();
  await supabase.rpc("worker_decline_job_request", {
    p_job: jobId,
    p_reason: reason || null,
  });

  revalidatePath("/jobs");
  revalidatePath("/portal/worker");
}

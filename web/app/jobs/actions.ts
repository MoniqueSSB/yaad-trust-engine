"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { parsePaymentStages } from "@/lib/jobs/payment-stages";
import { resolveBillingMode } from "@/lib/jobs/billing";
import { clientBill } from "@/lib/jobs/client-bill";

/**
 * Quote submission. Thin on purpose: jq_insert_vetted in Postgres is the
 * gate (published profile + signed Worker Guidelines + genuinely open job),
 * so a bug here is a refusal message, not an unvetted quote.
 */
export type SubmitQuoteResult = { ok: true } | { ok: false; error: string };

export async function submitQuote(formData: FormData): Promise<SubmitQuoteResult> {
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
  if (!jobId || !Number.isFinite(labour) || labour <= 0) {
    return { ok: false, error: "Put a labour price in before sending." };
  }
  /* The stages become the job's stage schedule the moment the client accepts
     (20260913230001), so they are checked here, before the quote goes, with
     the same rule the database applies. Founder decision, 13 Sep 2026:
     refuse until readable. */
  const stages = parsePaymentStages(paymentStageNote);
  if (!stages.ok) {
    return { ok: false, error: stages.error };
  }
  /* In full or by stage (20260914090641). Under J$100,000 all in it is always
     in full; the database refuses stage billing under the line too, so this
     is the readable version of the same rule, not the only one. */
  const billing = resolveBillingMode(
    clientBill(labour, materials).total,
    String(formData.get("billingMode") ?? "") || null,
  );
  if (!billing.ok) {
    return { ok: false, error: billing.error };
  }

  const supabase = await createClient();
  const email = (user.email ?? "").toLowerCase();
  const { data: profile } = await supabase
    .from("worker_profiles")
    .select("name")
    .eq("worker_email", email)
    .maybeSingle();

  /* The insert's answer is read, not dropped. Until 13 Sep 2026 this line
     discarded `error`, so a quote the database refused (an active profile
     with a Worker Guidelines signature on an old version was the real case)
     came back to the form as "quote sent" with nothing saved. A refusal from
     jq_insert_vetted arrives as a row-level security error; the message the
     worker sees names the three things it checks. */
  const { error } = await supabase.from("job_quotes").insert({
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
    billing_mode: billing.mode,
    status: "submitted",
  });
  if (error) {
    console.error("submitQuote refused:", error.code, error.message);
    return {
      ok: false,
      error: /row-level security|violates|permission/i.test(error.message)
        ? "The database refused this quote. Quoting needs an active worker profile, the CURRENT Worker Guidelines signed (if you signed a while ago, a newer version may be waiting for you under Guidelines in your portal), and a job that is still open."
        : "This quote did not save. Try again, and if it happens twice tell Yaadly.",
    };
  }

  /* Telling the client a price has landed is now a database trigger
     (notify_client_quote_arrived, fired on this same insert), not something
     the UI asks for. That is deliberate: the state change is the trigger,
     never the click. See 20260831i_notify_client_from_the_state_change.sql. */

  revalidatePath("/jobs");
  return { ok: true };
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

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

  const { data: quote } = await supabase.from("job_quotes").insert({
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
  }).select("id").single();

  /* What the job needs, item by item, written after the quote so the rows
     hang off a real id. Deliberately AFTER and not in the same statement:
     the quote is the thing a client is waiting on, and a malformed materials
     line must not cost the worker his whole quote. A quote with no list is a
     quote; a lost quote is a lost job.

     The three arrays come back from FormData in row order, so index i is one
     line. A row with no item name is an empty row somebody added and did not
     fill, which is not a refusal, it is just nothing. */
  if (quote?.id) {
    const items = formData.getAll("mat_item").map((v) => String(v).trim());
    const qtys  = formData.getAll("mat_qty").map((v) => String(v).trim());
    const units = formData.getAll("mat_unit").map((v) => String(v).trim());

    const rows = items
      .map((item, i) => ({
        quote_id: quote.id,
        sort: i,
        item: item.slice(0, 200),
        qty: qtys[i] ? Number(qtys[i]) : null,
        unit: (units[i] ?? "").slice(0, 40),
      }))
      .filter((r) => r.item !== "" && (r.qty === null || Number.isFinite(r.qty)));

    if (rows.length) await supabase.from("quote_materials").insert(rows);
  }

  /* Telling the client a price has landed is now a database trigger
     (notify_client_quote_arrived, fired on this same insert), not something
     the UI asks for. That is deliberate: the state change is the trigger,
     never the click. See 20260831i_notify_client_from_the_state_change.sql. */

  revalidatePath("/jobs");
}

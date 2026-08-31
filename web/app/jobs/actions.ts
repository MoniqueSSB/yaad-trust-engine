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
    status: "submitted",
  });

  /* Telling the client a price has landed is now a database trigger
     (notify_client_quote_arrived, fired on this same insert), not something
     the UI asks for. That is deliberate: the state change is the trigger,
     never the click. See 20260831i_notify_client_from_the_state_change.sql. */

  revalidatePath("/jobs");
}

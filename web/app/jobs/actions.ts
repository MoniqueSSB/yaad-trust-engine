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

  const { data: inserted, error: insertErr } = await supabase.from("job_quotes").insert({
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
  }).select("id").single();

  /* Tell the client a price has landed. Until this call existed nothing did:
     the quote sat on a page that was honest when empty, and the client had to
     think to come back and look. For somebody four thousand miles away that
     reads as silence, and a quote nobody is told about does not convert.

     It goes through an edge function rather than happening here because the
     client's email and phone are on the job and a WORKER must never read
     them. This action runs on the worker's session, so the lookup and the
     send happen somewhere holding the service key, and the worker never sees
     what it read. The function checks the caller's token against the quote's
     own worker, so this cannot be used to make Yaadly message anybody else.

     A failure here must never lose the quote, which is already saved. */
  if (!insertErr && inserted?.id) {
    try {
      await supabase.functions.invoke("yaad-quote-landed", { body: { quoteId: inserted.id } });
    } catch (e) {
      console.error("quote notification:", String(e).slice(0, 200));
    }
  }

  revalidatePath("/jobs");
}

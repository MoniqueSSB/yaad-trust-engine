"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { scrub } from "@/lib/scrub";

/** Tick your side of the scope. Postgres checks you are that side. */
export async function agreeScope(formData: FormData): Promise<void> {
  const user = await requireUser();
  const jobId = String(formData.get("jobId") ?? "");
  const side = String(formData.get("side") ?? "");
  if (!jobId || !["client", "worker"].includes(side)) return;
  const supabase = await createClient();
  await supabase.from("scope_agreements").insert({
    job_id: jobId, side, email: (user.email ?? "").toLowerCase(),
  });
  revalidatePath("/portal/jobs/" + jobId);
}

/** Choosing runs entirely inside choose_worker() in Postgres. */
export async function chooseQuote(formData: FormData): Promise<void> {
  await requireUser();
  const jobId = String(formData.get("jobId") ?? "");
  const quoteId = String(formData.get("quoteId") ?? "");
  if (!jobId || !quoteId) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("choose_worker", { p_job: jobId, p_quote: quoteId });
  if (error) throw new Error(error.message);
  revalidatePath("/portal/jobs/" + jobId);
}

/** Scrubbed before insert; the caller gets back what was removed and why. */
export async function sendMessage(
  jobId: string,
  body: string,
): Promise<{ hits: string[] }> {
  const user = await requireUser();
  const text = body.trim().slice(0, 1500);
  if (!text) return { hits: [] };
  const { clean, hits } = scrub(text);
  const supabase = await createClient();
  const { error } = await supabase.from("messages").insert({
    job_id: jobId, sender_email: (user.email ?? "").toLowerCase(), body: clean,
  });
  if (error) throw new Error("refused");
  revalidatePath("/portal/jobs/" + jobId);
  return { hits };
}

export async function raiseDispute(
  jobId: string,
  kinds: string[],
  body: string,
): Promise<void> {
  const user = await requireUser();
  const supabase = await createClient();
  const { clean } = scrub(body.trim().slice(0, 2000));
  const { error } = await supabase.from("disputes").insert({
    job_id: jobId, raised_by: (user.email ?? "").toLowerCase(),
    kinds: kinds.slice(0, 6), body: clean, state: "direct",
  });
  if (error) throw new Error("refused");
  revalidatePath("/portal/jobs/" + jobId);
}

export async function moveDispute(
  id: string, jobId: string,
  move: "reply" | "resolved" | "escalated",
  reply?: string,
): Promise<void> {
  await requireUser();
  const supabase = await createClient();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (move === "reply") patch.reply = scrub((reply ?? "").trim().slice(0, 2000)).clean;
  else patch.state = move;
  const { error } = await supabase.from("disputes").update(patch).eq("id", id);
  if (error) throw new Error("refused");
  revalidatePath("/portal/jobs/" + jobId);
}

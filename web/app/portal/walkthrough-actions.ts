"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * The video walkthrough: a client's alternative to approving straight off
 * the evidence package, worked out live on a call instead. Thin on purpose,
 * same shape as approveStage: request_walkthrough(), confirm_walkthrough()
 * and clear_walkthrough() in Postgres are the gate, so a bug here is a
 * refusal message, not a call nobody agreed to.
 */

export async function requestWalkthrough(formData: FormData): Promise<void> {
  await requireUser();
  const jobId = String(formData.get("jobId") ?? "");
  if (!jobId) return;

  const supabase = await createClient();
  const { error } = await supabase.rpc("request_walkthrough", {
    p_job: jobId,
    p_platform: String(formData.get("platform") ?? ""),
    p_date: String(formData.get("date") ?? ""),
    p_notes: String(formData.get("notes") ?? ""),
  });
  if (error) throw new Error(error.message);

  revalidatePath("/portal/jobs/" + jobId);
}

export async function confirmWalkthrough(formData: FormData): Promise<void> {
  await requireUser();
  const jobId = String(formData.get("jobId") ?? "");
  if (!jobId) return;

  const supabase = await createClient();
  const { error } = await supabase.rpc("confirm_walkthrough", {
    p_job: jobId,
    p_platform: String(formData.get("platform") ?? ""),
    p_date: String(formData.get("date") ?? ""),
    p_link: String(formData.get("link") ?? ""),
    p_who: String(formData.get("who") ?? ""),
  });
  if (error) throw new Error(error.message);

  revalidatePath("/portal/jobs/" + jobId);
}

export async function clearWalkthrough(formData: FormData): Promise<void> {
  await requireUser();
  const jobId = String(formData.get("jobId") ?? "");
  if (!jobId) return;

  const supabase = await createClient();
  const { error } = await supabase.rpc("clear_walkthrough", { p_job: jobId });
  if (error) throw new Error(error.message);

  revalidatePath("/portal/jobs/" + jobId);
}

export async function recordWalkthroughNotes(formData: FormData): Promise<void> {
  await requireUser();
  const jobId = String(formData.get("jobId") ?? "");
  if (!jobId) return;

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_walkthrough_notes", {
    p_job: jobId,
    p_notes: String(formData.get("notes") ?? ""),
  });
  if (error) throw new Error(error.message);

  revalidatePath("/portal/jobs/" + jobId);
}

export async function confirmWalkthroughNotes(formData: FormData): Promise<void> {
  await requireUser();
  const jobId = String(formData.get("jobId") ?? "");
  if (!jobId) return;

  const supabase = await createClient();
  const { error } = await supabase.rpc("confirm_walkthrough_notes", { p_job: jobId });
  if (error) throw new Error(error.message);

  revalidatePath("/portal/jobs/" + jobId);
}

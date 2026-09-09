"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * The independent check at sign-off: a client's optional add-on, somebody
 * independent of the worker attends the finished stage. Thin on purpose, the
 * same shape as the walkthrough actions: choose_job_check() and
 * clear_job_check() in Postgres are the gate, so a bug here is a refusal
 * message, not a visit nobody agreed to.
 *
 * Nothing here touches money or approval. The invoice for the check is raised
 * by a signed-in admin on the desk (raise_job_check_invoice), and the Approve
 * button never reads the choice.
 */

export async function chooseJobCheck(formData: FormData): Promise<void> {
  await requireUser();
  const jobId = String(formData.get("jobId") ?? "");
  if (!jobId) return;

  const supabase = await createClient();
  const { error } = await supabase.rpc("choose_job_check", {
    p_job: jobId,
    p_level: String(formData.get("level") ?? ""),
  });
  if (error) throw new Error(error.message);

  revalidatePath("/portal/jobs/" + jobId);
}

export async function clearJobCheck(formData: FormData): Promise<void> {
  await requireUser();
  const jobId = String(formData.get("jobId") ?? "");
  if (!jobId) return;

  const supabase = await createClient();
  const { error } = await supabase.rpc("clear_job_check", { p_job: jobId });
  if (error) throw new Error(error.message);

  revalidatePath("/portal/jobs/" + jobId);
}

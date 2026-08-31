"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * The Arrival Log check-in. Thin on purpose, same shape as approveStage:
 * log_arrival() in Postgres is the gate (this job's own worker, once per
 * stage per Jamaica-local day), so a bug here is a refusal message, not a
 * false record of somebody being on site.
 */
export async function logArrival(formData: FormData): Promise<void> {
  await requireUser();
  const jobId = String(formData.get("jobId") ?? "");
  if (!jobId) return;

  const supabase = await createClient();
  const { error } = await supabase.rpc("log_arrival", { p_job: jobId });
  if (error) throw new Error(error.message);

  revalidatePath("/portal/jobs/" + jobId);
}

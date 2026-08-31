"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * A worker recording how they were paid for a job, off-platform. Thin on
 * purpose, same shape as approveStage: record_pay_info() in Postgres is the
 * gate (this job's own worker, one of the three real methods), so a bug here
 * is a refusal message, not a wrong record.
 */
export async function recordPayInfo(formData: FormData): Promise<void> {
  await requireUser();
  const jobId = String(formData.get("jobId") ?? "");
  const method = String(formData.get("method") ?? "");
  const ref = String(formData.get("ref") ?? "");
  if (!jobId) return;

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_pay_info", {
    p_job: jobId,
    p_method: method,
    p_ref: ref,
  });

  if (error) throw new Error(error.message);

  revalidatePath("/portal/worker");
}

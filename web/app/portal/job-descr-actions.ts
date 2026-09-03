"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * The client correcting the description of their own job.
 *
 * Every rule lives in edit_job_descr_as_me() in Postgres (20260903a): who may
 * change it, until when, and how long it may be. This carries the form to it
 * and carries the refusal back in the words the database used, because those
 * words tell the client what to do next and "refused" does not.
 *
 * Nothing here decides anything. The moment this file starts deciding who
 * may edit, there are two rules, and the one in the browser is the one that
 * can be walked around.
 */
export async function editJobDescr(formData: FormData): Promise<void> {
  await requireUser();
  const jobId = String(formData.get("jobId") ?? "");
  const descr = String(formData.get("descr") ?? "").trim().slice(0, 4000);
  if (!jobId) throw new Error("missing");

  const supabase = await createClient();
  const { error } = await supabase.rpc("edit_job_descr_as_me", {
    p_job: jobId,
    p_descr: descr,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/portal/jobs/" + jobId);
}

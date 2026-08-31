"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * The approve button. Thin on purpose, same shape as submitQuote and
 * chooseQuote: approve_stage() in Postgres is the gate (client of record,
 * evidence actually filed, no open dispute), so a bug here is a refusal
 * message, not an unrecorded approval.
 *
 * requireUser() is a UI nicety, not the security boundary. approve_stage()
 * checks auth.uid() itself and would refuse an anonymous call regardless of
 * what happens above it, the same relationship submitQuote has to
 * jq_insert_vetted.
 */
export async function approveStage(formData: FormData): Promise<void> {
  await requireUser();
  const jobId = String(formData.get("jobId") ?? "");
  if (!jobId) return;
  // Anything other than "in_person" is the original path, evidence review.
  // Not a form the caller can get wrong: approve_stage() applies the same
  // fallback itself, this just avoids sending a stray value needlessly.
  const method = String(formData.get("method") ?? "") === "in_person" ? "in_person" : "evidence";

  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_stage", { p_job: jobId, p_method: method });

  // The database's own sentence is the one worth keeping: "A dispute is open
  // on this job" or "Nothing has been filed for this stage yet" tells the
  // person what to do next. Swallowing it into a generic failure would throw
  // that away for no reason, so it is re-thrown as-is and EvidenceLedger's
  // caller shows it.
  if (error) throw new Error(error.message);

  revalidatePath("/portal/jobs/" + jobId);
}

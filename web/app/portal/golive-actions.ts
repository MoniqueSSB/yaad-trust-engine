"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Put the finished jobs on the board.
 *
 * client_go_live() already ran once, at the moment the Client Guidelines were
 * signed, and that was the only place it ran. It opens every job that is
 * waiting ONLY on the signature, and it deliberately skips any job with no
 * nominated materials store (20260828e, part THREE), because opening one job
 * must not fail the statement for all of them.
 *
 * Which left a job that cleared its gates in the wrong order with nowhere to
 * go. Sign first, nominate the store afterwards, and the job now satisfies
 * every condition in the function, but the function had already run and
 * nothing was ever going to call it again. The job sat closed, correct by
 * every rule, invisible to every worker, with no control anywhere that would
 * move it.
 *
 * So the checklist gets a button, and the button is this. Calling it again is
 * safe by construction: it upserts the profile and opens only jobs that are
 * still shut and still qualify, so a second press on an already-live job is a
 * statement that matches nothing.
 *
 * The gates are not re-checked here. They are in the function, in Postgres,
 * where a rule about who sees somebody's property should be, and a copy in
 * this file would only be a second rule that could disagree with the first.
 */
export async function goLive(formData: FormData): Promise<void> {
  await requireUser();
  const jobId = String(formData.get("jobId") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.rpc("client_go_live");

  // The database refuses in sentences meant for the client, so pass them on
  // rather than replacing them with a word of our own.
  if (error) throw new Error(error.message);

  if (jobId) revalidatePath("/portal/jobs/" + jobId);
  revalidatePath("/portal");
  revalidatePath("/jobs");
}

"use server";

import { revalidatePath } from "next/cache";
import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * The Arrival Log check-in. Thin on purpose, same shape as approveStage:
 * log_arrival() in Postgres is the gate (this job's own worker, once per
 * stage per Jamaica-local day), so a bug here is a refusal message, not a
 * false record of somebody being on site.
 *
 * lat/lon/accuracy are the one GPS reading the browser captured at the
 * moment of the tap (see ArrivalCheckIn). All three are optional: a
 * worker who declined the location prompt, or whose phone could not get a
 * fix, still gets to check in. log_arrival() stores whatever it is given
 * and never refuses the check-in for missing coordinates.
 */
export type ArrivalResult = { ok: true } | { ok: false; message: string };

/* Returned, never thrown (28 Sep 2026). A thrown error reaches the browser in
   production as "Minified React error #441" with the reason stripped out,
   which is what a worker saw on pressing "I'm on site" after their session
   had ended. Same rule as uploadEvidence (14 Sep 2026). */
export async function logArrival(formData: FormData): Promise<ArrivalResult> {
  const user = await getUser();
  if (!user) {
    return { ok: false, message: "You have been signed out. Sign in again, then press I'm on site once more." };
  }
  const jobId = String(formData.get("jobId") ?? "");
  if (!jobId) return { ok: false, message: "This job could not be found. Reload the page and try again." };

  const lat = formData.get("lat");
  const lon = formData.get("lon");
  const accuracy = formData.get("accuracy");

  const supabase = await createClient();
  const { error } = await supabase.rpc("log_arrival", {
    p_job: jobId,
    p_lat: lat ? Number(lat) : null,
    p_lon: lon ? Number(lon) : null,
    p_accuracy_m: accuracy ? Number(accuracy) : null,
  });
  if (error) return { ok: false, message: error.message };

  revalidatePath("/portal/jobs/" + jobId);
  return { ok: true };
}

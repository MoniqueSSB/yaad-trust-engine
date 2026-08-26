"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Calendar writes. Thin on purpose: every rule that matters (who may toggle
 * whose diary, who may request against which job, one confirmed visit per
 * day) lives in Postgres. A bug here is an error message, not a breach.
 */

export async function toggleDay(formData: FormData) {
  const user = await requireUser();
  const day = String(formData.get("day") ?? "");
  const path = String(formData.get("path") ?? "/portal");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;

  const supabase = await createClient();
  const email = (user.email ?? "").toLowerCase();

  const { data: existing } = await supabase
    .from("worker_availability")
    .select("open")
    .eq("owner_email", email)
    .eq("day", day)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("worker_availability")
      .update({ open: !existing.open, updated_at: new Date().toISOString() })
      .eq("owner_email", email)
      .eq("day", day);
  } else {
    await supabase
      .from("worker_availability")
      .insert({ owner_email: email, day, open: true });
  }
  revalidatePath(path);
}

export async function requestVisit(formData: FormData) {
  const user = await requireUser();
  const day = String(formData.get("day") ?? "");
  const slot = String(formData.get("slot") ?? "");
  const jobId = String(formData.get("jobId") ?? "");
  const kind = String(formData.get("kind") ?? "job");
  const owner = String(formData.get("owner") ?? "");
  const path = String(formData.get("path") ?? "/portal");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !slot || !jobId || !owner) return;

  const supabase = await createClient();
  // Booking into your own diary confirms immediately; anyone else requests.
  const own = owner.toLowerCase() === (user.email ?? "").toLowerCase();
  await supabase.from("visits").insert({
    owner_email: owner.toLowerCase(),
    kind: kind === "service" ? "service" : "job",
    job_id: jobId,
    day,
    slot,
    state: own ? "confirmed" : "pending",
    requested_by: (user.email ?? "").toLowerCase(),
  });
  revalidatePath(path);
}

export async function setVisitState(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id") ?? "");
  const state = String(formData.get("state") ?? "");
  const path = String(formData.get("path") ?? "/portal");
  if (!id || !["confirmed", "done", "cancelled"].includes(state)) return;

  const supabase = await createClient();
  // RLS only lets the diary owner (or admin) update, and the partial unique
  // index refuses a second confirmed visit on the same day.
  await supabase
    .from("visits")
    .update({ state, updated_at: new Date().toISOString() })
    .eq("id", id);
  revalidatePath(path);
}

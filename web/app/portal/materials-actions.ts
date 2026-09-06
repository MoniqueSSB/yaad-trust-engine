"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Where materials are kept on the property, recorded by the client.
 *
 * Every rule about this lives in nominate_materials_store() in Postgres
 * (20260828d): who may answer, which answers exist, and when a description is
 * required. This function carries the form to it and carries the refusal
 * back in the words the database used, because those words tell the client
 * what to do next and "refused" does not.
 *
 * Nothing here decides anything. The moment this page starts deciding who may
 * nominate, there are two rules, and the one in the browser is the one that
 * can be walked around.
 */
export async function nominateMaterialsStore(formData: FormData): Promise<void> {
  await requireUser();
  const jobId = String(formData.get("jobId") ?? "");
  const type = String(formData.get("storeType") ?? "");
  const where = String(formData.get("storeWhere") ?? "").trim().slice(0, 160);
  if (!jobId) throw new Error("missing");

  const supabase = await createClient();
  const { error } = await supabase.rpc("nominate_materials_store", {
    p_job: jobId,
    p_type: type,
    p_where: where,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/portal/jobs/" + jobId);
}

/**
 * Route B. The client ticks one line of the worker's materials list off as it
 * lands on site, or takes the tick back.
 *
 * Every rule lives in mark_material_supplied() in Postgres (20260905d): who
 * may tick, and that only supplied_at and supplied_by move. It is an RPC
 * rather than an update policy because row level security cannot say "these
 * columns only", and a broad policy would let the person filling the order
 * rewrite the item or the quantity on a quote they are about to accept.
 *
 * Same shape as nominateMaterialsStore above: this carries the form to the
 * database and carries the refusal back in the words the database used.
 */
export async function markMaterialSupplied(formData: FormData): Promise<void> {
  await requireUser();
  const lineId = String(formData.get("lineId") ?? "");
  const jobId = String(formData.get("jobId") ?? "");
  const on = String(formData.get("on") ?? "true") === "true";
  if (!lineId || !jobId) throw new Error("missing");

  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_material_supplied", {
    p_line: lineId,
    p_on: on,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/portal/jobs/" + jobId);
}

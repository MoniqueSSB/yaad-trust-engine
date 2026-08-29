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

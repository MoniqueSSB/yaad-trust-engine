"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Linking a worker's WhatsApp number, so evidence they send there can find
 * its way to the right job. Thin on purpose, same shape as recordPayInfo:
 * link_worker_phone() in Postgres is the gate.
 */
export async function linkWorkerPhone(formData: FormData): Promise<void> {
  await requireUser();
  const phone = String(formData.get("phone") ?? "");
  if (!phone) return;

  const supabase = await createClient();
  const { error } = await supabase.rpc("link_worker_phone", { p_phone: phone });
  if (error) throw new Error(error.message);

  revalidatePath("/portal/worker");
}

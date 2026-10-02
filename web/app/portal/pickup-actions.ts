"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * A worker with no bank account giving the name on their ID and the parish
 * they will collect a MoneyGram cash pick-up in (20261001194258). Thin on
 * purpose: set_cash_pickup() in Postgres is the gate. It refuses while
 * MoneyGram is switched off, checks the name and parish, touches only the
 * signed-in worker's row, and clears the call-back so the new name is
 * checked by phone before any money goes. An empty name removes pick-up.
 */
export type PickupResult = { ok: true } | { ok: false; error: string };

export async function saveCashPickup(formData: FormData): Promise<PickupResult> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_cash_pickup", {
    p_name: String(formData.get("name") ?? ""),
    p_parish: String(formData.get("parish") ?? ""),
  });
  if (error) return { ok: false, error: error.message || "That did not save. Try again, or ask Yaadly." };
  revalidatePath("/portal/worker/payouts");
  return { ok: true };
}

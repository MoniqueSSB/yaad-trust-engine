"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * A worker giving their TRN from their own portal, just before their first
 * payment (founder, 25 Oct 2026: the TRN moved out of the ID stage). Thin on
 * purpose: submit_my_trn() in Postgres is the gate. It finds the signed-in
 * worker's own application, takes nine digits, and records them as pending.
 * A person at the desk checks them against the ID and presses TRN approved;
 * nobody is paid before that.
 */
export type TrnResult = { ok: true } | { ok: false; error: string };

export async function submitMyTrn(formData: FormData): Promise<TrnResult> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_my_trn", { p_trn: String(formData.get("trn") ?? "") });
  if (error) return { ok: false, error: error.message || "That did not save. Try again, or ask Yaadly." };
  revalidatePath("/portal/worker");
  return { ok: true };
}

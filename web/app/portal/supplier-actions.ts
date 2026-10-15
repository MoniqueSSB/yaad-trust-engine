"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * The four things a supplier does to an order, each one a Postgres function
 * (20261015120000) that checks the order is made out to the caller's own
 * supplier account before touching it. Thin on purpose, like
 * materials-actions.ts: the rule lives in the database, and this file only
 * carries the form there and the refusal back in the database's own words.
 *
 * None of these moves money. Releasing, matching and paying are a named
 * person's clicks on the desk, and nothing a supplier can call reaches them.
 */
export type SupplierResult = { ok: true } | { ok: false; error: string };

async function call(fn: string, args: Record<string, unknown>): Promise<SupplierResult> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, error: error.message || "That did not save. Try again, or ask Yaadly." };
  revalidatePath("/portal/supplier");
  return { ok: true };
}

export async function confirmOrder(formData: FormData): Promise<SupplierResult> {
  return call("supplier_confirm_release", { p_release: String(formData.get("release") ?? "") });
}

export async function markReady(formData: FormData): Promise<SupplierResult> {
  return call("supplier_mark_ready", { p_release: String(formData.get("release") ?? "") });
}

export async function markCollected(formData: FormData): Promise<SupplierResult> {
  return call("supplier_mark_collected", {
    p_release: String(formData.get("release") ?? ""),
    p_code: String(formData.get("code") ?? "").trim().slice(0, 20),
  });
}

export async function attachInvoice(formData: FormData): Promise<SupplierResult> {
  return call("supplier_attach_invoice", {
    p_release: String(formData.get("release") ?? ""),
    p_ref: String(formData.get("ref") ?? "").trim().slice(0, 60),
  });
}

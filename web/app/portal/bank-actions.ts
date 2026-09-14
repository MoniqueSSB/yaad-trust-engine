"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * A worker giving their bank details, which go straight to Yaadly's Wise
 * Business account as a recipient. Thin on purpose: yaad-wise-recipient is
 * the gate, and Yaadly keeps only Wise's reference (20260914240000). Nothing
 * typed here is logged or stored on the way through.
 */
export type BankResult = { ok: true } | { ok: false; error: string; fields: Record<string, string> };

const NOT_NOW = "Saving bank details is not available right now. Try again later, or ask Yaadly.";
const KEYS = ["accountHolderName", "accountNumber", "swiftCode", "branchCode", "city", "firstLine"] as const;

export async function saveBankDetails(formData: FormData): Promise<BankResult> {
  await requireUser();
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return { ok: false, error: NOT_NOW, fields: {} };

  const details: Record<string, string> = {};
  for (const k of KEYS) details[k] = String(formData.get(k) ?? "");
  const bank = String(formData.get("bank") ?? "");
  if (bank && bank !== "other") details.swiftCode = bank;

  const supabase = await createClient();
  const { data: session } = await supabase.auth.getSession();
  const token = session?.session?.access_token ?? "";
  if (!token) return { ok: false, error: "Sign in again, then try.", fields: {} };

  try {
    const r = await fetch(`${base}/functions/v1/yaad-wise-recipient`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ details }),
      signal: AbortSignal.timeout(25000),
    });
    const out = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string; fields?: Record<string, string> };
    if (!r.ok || !out.ok) return { ok: false, error: out.error ?? NOT_NOW, fields: out.fields ?? {} };
    revalidatePath("/portal/worker/payouts");
    revalidatePath("/portal/worker");
    return { ok: true };
  } catch {
    return { ok: false, error: NOT_NOW, fields: {} };
  }
}

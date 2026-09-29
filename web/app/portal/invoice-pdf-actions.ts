"use server";

import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * The PDF of one invoice the signed-in person can already read in the portal
 * (founder, 28 Sep 2026: "invoice download as pdf also"). yaad-invoice draws
 * it with the same invoicePdf() the emailed invoice carries, and reads the
 * invoice under this person's own session, so row level security decides who
 * gets which invoice exactly as the portal page does. This only passes the
 * session along and hands back the file.
 */
export type InvoicePdfResult = { ok: true; filename: string; pdf: string } | { ok: false; error: string };

export async function invoicePdf(invoiceId: string): Promise<InvoicePdfResult> {
  await requireUser();
  const id = String(invoiceId ?? "").trim();
  if (!id) return { ok: false, error: "No invoice was chosen." };
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return { ok: false, error: "The PDF is not available right now." };

  const supabase = await createClient();
  const { data: session } = await supabase.auth.getSession();
  const token = session?.session?.access_token ?? "";
  if (!token) return { ok: false, error: "Sign in again, then try." };

  try {
    const r = await fetch(`${base}/functions/v1/yaad-invoice`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "pdf", invoice_id: id }),
      signal: AbortSignal.timeout(30000),
    });
    const out = (await r.json().catch(() => ({}))) as { filename?: string; pdf?: string; error?: string };
    if (!r.ok || !out.pdf) return { ok: false, error: out.error ?? "The PDF could not be made. Try again in a moment." };
    return { ok: true, filename: out.filename ?? `${id}.pdf`, pdf: out.pdf };
  } catch {
    return { ok: false, error: "The PDF could not be made. Try again in a moment." };
  }
}

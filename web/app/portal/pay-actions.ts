"use server";

import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Start a card payment for one of the signed-in client's invoices.
 *
 * Thin on purpose, same shape as worker-phone-actions: yaad-checkout is the
 * gate. It checks the invoice is this client's, sent and unpaid, and asks
 * Stripe for a payment page for exactly its total. This only passes the
 * client's own session along and hands back the page's address.
 *
 * Paying does not mark the invoice paid here or anywhere else in the app.
 * Stripe's confirmation is recorded, and a named person at Yaadly marks it
 * paid. Phase 1 of card payment, 14 Sep 2026, Stripe test mode.
 */

export type CardPayResult = { ok: true; url: string } | { ok: false; error: string };

export async function startCardPayment(invoiceId: string): Promise<CardPayResult> {
  await requireUser();
  const id = String(invoiceId ?? "").trim();
  if (!id) return { ok: false, error: "No invoice was chosen." };

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return { ok: false, error: "Card payment is not available right now. Pay by bank transfer." };

  const supabase = await createClient();
  const { data: session } = await supabase.auth.getSession();
  const token = session?.session?.access_token ?? "";
  if (!token) return { ok: false, error: "Sign in again, then try." };

  try {
    const r = await fetch(`${base}/functions/v1/yaad-checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ invoice_id: id }),
      signal: AbortSignal.timeout(20000),
    });
    const out = (await r.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!r.ok || !out.url) {
      return { ok: false, error: out.error ?? "Card payment could not be started. Try again, or pay by bank transfer." };
    }
    // Only ever send the client to Stripe's own checkout host.
    if (!/^https:\/\/checkout\.stripe\.com\//.test(out.url)) {
      return { ok: false, error: "Card payment could not be started. Try again, or pay by bank transfer." };
    }
    return { ok: true, url: out.url };
  } catch {
    return { ok: false, error: "Card payment could not be started. Try again, or pay by bank transfer." };
  }
}

"use server";

import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * A worker setting up how Yaadly pays them, on Stripe's own form.
 *
 * Thin on purpose, same shape as pay-actions: yaad-payout-setup is the gate.
 * It checks the signed-in person is a Yaadly tradesperson, makes them a
 * Stripe recipient if they are not one yet, and hands back Stripe's one-time
 * sign-up link. Yaadly never sees or keeps a bank detail: the worker types
 * them into Stripe. 20260914200000.
 */

export type PayoutStart = { ok: true; url: string } | { ok: false; error: string };
export type PayoutState = "none" | "started" | "ready" | "needs_info";

const NOT_NOW = "Setting up payment is not available right now. Try again later, or ask Yaadly.";

async function call(action: "start" | "status"): Promise<{ ok: boolean; body: { url?: string; state?: PayoutState; error?: string } }> {
  await requireUser();
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return { ok: false, body: { error: NOT_NOW } };

  const supabase = await createClient();
  const { data: session } = await supabase.auth.getSession();
  const token = session?.session?.access_token ?? "";
  if (!token) return { ok: false, body: { error: "Sign in again, then try." } };

  try {
    const r = await fetch(`${base}/functions/v1/yaad-payout-setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action }),
      signal: AbortSignal.timeout(20000),
    });
    return { ok: r.ok, body: (await r.json().catch(() => ({}))) as { url?: string; state?: PayoutState; error?: string } };
  } catch {
    return { ok: false, body: { error: NOT_NOW } };
  }
}

export async function startPayoutSetup(): Promise<PayoutStart> {
  const { ok, body } = await call("start");
  // Only ever send a worker to Stripe's own pages.
  if (!ok || !body.url || !/^https:\/\/([a-z0-9-]+\.)*stripe\.com\//.test(body.url)) {
    return { ok: false, error: body.error ?? NOT_NOW };
  }
  return { ok: true, url: body.url };
}

export async function checkPayoutSetup(): Promise<PayoutState | null> {
  const { ok, body } = await call("status");
  return ok && body.state ? body.state : null;
}

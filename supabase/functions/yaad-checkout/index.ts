/* ── yaad-checkout ──────────────────────────────────────────────────────────
 *
 * A Stripe card payment page for one invoice, for the client it is billed to.
 *
 * WHY. Founder's instruction, 14 Sep 2026: a client should be able to tap an
 * unpaid invoice in the portal and pay it there by card. Phase 1 runs on
 * Stripe TEST keys only.
 *
 * WHAT IT DOES. A signed-in client posts { invoice_id }. This checks the
 * invoice is theirs (the same email rule as invoices_client_read), is sent
 * and unpaid, is Yaadly's to collect rather than a worker payable, and has
 * no card payment already recorded against it. Then it asks Stripe for a
 * Checkout page for exactly that invoice's total, with the invoice number
 * attached, and returns its address.
 *
 * WHAT IT NEVER DOES. It does not mark anything paid and it does not start a
 * job. Stripe telling yaad-stripe-webhook that the card was charged is
 * recorded in invoice_payments; a named person at Yaadly then marks the
 * invoice paid, as before. CLAUDE.md §2 and §9.
 *
 * LIVE KEYS ARE REFUSED unless STRIPE_ALLOW_LIVE is exactly "yes". Setting
 * the live key before anybody has decided to take real money must not
 * quietly start taking it.
 *
 * Runs with the platform's JWT check ON (verify_jwt = true). It is called
 * server side from the portal with the client's own session token.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { httpAttrs, SpanKind, Trace } from "./otel.ts";
import { buildCheckoutForm, isLiveKey, STRIPE_CURRENCIES, toStripeAmount } from "./stripe.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const APP_URL = (Deno.env.get("YAADLY_APP_URL") ?? "https://app.yaadly.co.uk").replace(/\/+$/, "");

Deno.serve(async (req: Request) => {
  const trace = new Trace("yaad-checkout", req);
  const root = trace.startSpan(`${req.method} /yaad-checkout`, SpanKind.SERVER, httpAttrs(req));
  const done = (body: unknown, status: number) => {
    root.setAttributes({ "http.response.status_code": status });
    root.end(); trace.flush();
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  };
  const fail = (error: string, status: number) => done({ error }, status);

  if (req.method !== "POST") return fail("POST only.", 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return fail("Not configured.", 500);

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  if (!stripeKey) return fail("Card payment is not switched on yet. Pay by bank transfer for now.", 503);
  if (isLiveKey(stripeKey) && Deno.env.get("STRIPE_ALLOW_LIVE") !== "yes") {
    console.error("yaad-checkout: a LIVE Stripe key is set but STRIPE_ALLOW_LIVE is not 'yes'. Refusing.");
    return fail("Card payment is in test mode only.", 503);
  }
  root.setAttributes({ "yaadly.checkout.livemode": isLiveKey(stripeKey) });

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: who, error: whoErr } = await admin.auth.getUser(jwt);
    const email = (who?.user?.email ?? "").trim().toLowerCase();
    if (whoErr || !email) return fail("Sign in again, then try.", 401);

    const body = await req.json().catch(() => ({}));
    const invoiceId = String(body?.invoice_id ?? "").trim();
    if (!invoiceId) return fail("invoice_id required.", 400);
    root.setAttributes({ "yaadly.invoice.id": invoiceId });

    const { data: inv, error: invErr } = await admin
      .from("invoices")
      .select("id, job_id, status, payable_to, currency, total_pence, client_email")
      .eq("id", invoiceId)
      .maybeSingle();
    if (invErr) return fail("Could not read that invoice.", 502);

    // Not found and not yours read the same, so this cannot be used to learn
    // which invoice numbers exist.
    if (!inv || (inv.client_email ?? "").trim().toLowerCase() !== email) {
      return fail("That invoice is not one of yours.", 404);
    }
    if (inv.payable_to === "worker") return fail("That invoice is not one you pay.", 409);
    if (inv.status === "paid") return fail("That invoice is already paid.", 409);
    if (inv.status !== "sent") return fail("That invoice cannot be paid yet.", 409);

    const currency = String(inv.currency ?? "").toUpperCase();
    if (!(STRIPE_CURRENCIES as readonly string[]).includes(currency)) {
      return fail(`Card payment is not set up for ${currency || "this currency"}. Pay by bank transfer.`, 409);
    }
    let unitAmount: number;
    try {
      unitAmount = toStripeAmount(Number(inv.total_pence), currency);
    } catch (e) {
      return fail(String((e as Error).message), 409);
    }

    // One card payment per invoice. A second payment page for an invoice
    // Stripe already says is paid would take the money twice.
    const { data: already } = await admin
      .from("invoice_payments")
      .select("id")
      .eq("invoice_id", inv.id)
      .eq("status", "succeeded")
      .limit(1);
    if (already && already.length) {
      return fail("A card payment for this invoice has already been received. Yaadly is confirming it.", 409);
    }

    const back = inv.job_id
      ? `${APP_URL}/portal/jobs/${encodeURIComponent(inv.job_id)}?tab=approvals`
      : `${APP_URL}/portal`;
    const anchor = `#invoice-${encodeURIComponent(inv.id)}`;

    // The same session yaad-pay asks for from the email link (_shared/stripe.ts).
    const form = buildCheckoutForm({
      invoiceId: inv.id,
      jobId: inv.job_id ?? null,
      email,
      currency,
      unitAmount,
      successUrl: `${back}${inv.job_id ? "&" : "?"}card=paid${anchor}`,
      cancelUrl: `${back}${inv.job_id ? "&" : "?"}card=cancelled${anchor}`,
    });

    const res = await trace.span("stripe.checkout.sessions.create", SpanKind.CLIENT, { "server.address": "api.stripe.com" }, async (s) => {
      const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${stripeKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
          // A double tap inside ten minutes gets the same page, not two.
          "Idempotency-Key": `yaadly-checkout-${inv.id}-${unitAmount}-${Math.floor(Date.now() / 600000)}`,
        },
        body: form.toString(),
        signal: AbortSignal.timeout(15000),
      });
      s.setAttributes({ "http.response.status_code": r.status });
      return r;
    });

    const session = await res.json().catch(() => ({}));
    if (!res.ok || !session?.url) {
      const msg = session?.error?.message ?? `Stripe answered ${res.status}`;
      console.error(`yaad-checkout: Stripe refused a session for ${inv.id}: ${String(msg).slice(0, 300)}`);
      return fail("Card payment could not be started. Try again, or pay by bank transfer.", 502);
    }

    root.setAttributes({ "yaadly.checkout.session": String(session.id ?? "") });
    return done({ url: session.url }, 200);
  } catch (e) {
    console.error("yaad-checkout: threw:", String(e).slice(0, 300));
    root.recordError(e);
    return fail("Card payment could not be started. Try again, or pay by bank transfer.", 500);
  }
});

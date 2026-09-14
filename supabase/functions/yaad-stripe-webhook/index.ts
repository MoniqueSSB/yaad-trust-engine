/* ── yaad-stripe-webhook ────────────────────────────────────────────────────
 *
 * Stripe telling Yaadly that a client's card payment went through.
 *
 * WHY. yaad-checkout gives a client a Stripe payment page for one invoice.
 * When they pay, Stripe posts here, and the payment is written to
 * invoice_payments so the desk can see it arrived. Phase 1 of card payment,
 * founder's instruction, 14 Sep 2026.
 *
 * RECORDED, NOT TRUSTED. This never writes invoices.status. "Paid" on an
 * invoice is a named person's click at the desk, as it has always been,
 * because paying the invoice that starts a job is what starts the job
 * (CLAUDE.md §2, §3 and §9). "Stripe says the card was charged, so mark it
 * paid automatically" is the request §3 exists to refuse.
 *
 * AMOUNT CHECK. The amount and currency Stripe reports are compared with the
 * invoice. A match is stored as 'succeeded'. Anything else is stored as
 * 'mismatch' so a person looks at it; it is never silently dropped, because
 * a real card was charged either way.
 *
 * THE SIGNATURE IS THE ONLY DOOR. Runs with --no-verify-jwt, because Stripe
 * holds no Supabase session. Verifies Stripe's HMAC signature over the raw
 * body with STRIPE_WEBHOOK_SECRET (_shared/stripe.ts). A missing secret is
 * refused with 503, never waved through, and a bad signature with 403: the
 * two must not look the same in a log. Same rule as yaad-inbound and
 * yaad-message-status.
 *
 * RETRIES. Unlike Twilio's delivery receipts, a lost payment record is not
 * cosmetic, so a database failure returns 500 and Stripe retries (with
 * backoff, for up to three days). A duplicate delivery of the same event is
 * harmless: provider_ref is unique and a repeat is ignored.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { httpAttrs, SpanKind, Trace } from "./otel.ts";
import { checkStripeSignature, fromStripeAmount, toStripeAmount } from "./stripe.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

Deno.serve(async (req: Request) => {
  const trace = new Trace("yaad-stripe-webhook", req);
  const root = trace.startSpan(`${req.method} /yaad-stripe-webhook`, SpanKind.SERVER, httpAttrs(req));
  const done = (body: string, status: number) => {
    root.setAttributes({ "http.response.status_code": status });
    root.end(); trace.flush();
    return new Response(body, { status, headers: { "Content-Type": "text/plain" } });
  };

  if (req.method !== "POST") return done("POST only.", 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return done("Not configured.", 500);

  try {
    const raw = await req.text();
    const sig = await checkStripeSignature(raw, req.headers.get("stripe-signature"), Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "");
    root.setAttributes({ "yaadly.stripe.signature_checked": sig.checked, "yaadly.stripe.signature_ok": sig.ok });
    if (!sig.checked) {
      console.error("yaad-stripe-webhook: STRIPE_WEBHOOK_SECRET is not set, refusing every event until it is.");
      return done("Verification is not configured.", 503);
    }
    if (!sig.ok) return done("Signature check failed.", 403);

    const event = JSON.parse(raw);
    const type = String(event?.type ?? "");
    root.setAttributes({ "yaadly.stripe.event": type });

    // Only the two events that mean money arrived. Everything else is
    // acknowledged and ignored, so Stripe does not keep retrying it.
    if (type !== "checkout.session.completed" && type !== "checkout.session.async_payment_succeeded") {
      return done("Ignored.", 200);
    }
    const s = event?.data?.object ?? {};
    // A completed session paid by a slower method (a bank debit) is not paid
    // yet; its async_payment_succeeded event is the one that counts.
    if (type === "checkout.session.completed" && s.payment_status !== "paid") {
      return done("Not paid yet.", 200);
    }

    const invoiceId = String(s?.metadata?.invoice_id ?? s?.client_reference_id ?? "").trim();
    const sessionId = String(s?.id ?? "").trim();
    if (!invoiceId || !sessionId) {
      console.error(`yaad-stripe-webhook: paid session ${sessionId || "?"} carries no invoice number.`);
      return done("No invoice on this payment.", 200);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: inv, error: invErr } = await admin
      .from("invoices")
      .select("id, total_pence, currency")
      .eq("id", invoiceId)
      .maybeSingle();
    if (invErr) return done("Could not read the invoice.", 500);
    if (!inv) {
      console.error(`yaad-stripe-webhook: paid session ${sessionId} names ${invoiceId}, which does not exist.`);
      return done("Unknown invoice.", 200);
    }

    const currency = String(s?.currency ?? "").toUpperCase();
    const amountMinor = Number(s?.amount_total ?? 0);
    let expected: number | null = null;
    try { expected = toStripeAmount(Number(inv.total_pence), String(inv.currency)); } catch { expected = null; }
    const matches = currency === String(inv.currency ?? "").toUpperCase() && expected !== null && amountMinor === expected;

    const { error: insErr } = await admin.from("invoice_payments").upsert({
      invoice_id: inv.id,
      provider: "stripe",
      provider_ref: sessionId,
      payment_intent: s?.payment_intent ? String(s.payment_intent) : null,
      amount_minor: amountMinor,
      amount_stored: fromStripeAmount(amountMinor, currency),
      currency,
      livemode: event?.livemode === true,
      status: matches ? "succeeded" : "mismatch",
    }, { onConflict: "provider_ref", ignoreDuplicates: true });

    if (insErr) {
      console.error(`yaad-stripe-webhook: could not record ${sessionId} for ${inv.id}:`, insErr.message);
      return done("Could not record the payment.", 500);
    }

    root.setAttributes({ "yaadly.invoice.id": inv.id, "yaadly.stripe.matches": matches });
    if (!matches) {
      console.error(`yaad-stripe-webhook: ${inv.id} was paid ${amountMinor} ${currency} but the invoice expects ${expected} ${inv.currency}. Recorded as a mismatch for a person to check.`);
    }
    return done("Recorded.", 200);
  } catch (e) {
    console.error("yaad-stripe-webhook: threw:", String(e).slice(0, 300));
    root.recordError(e);
    return done("Could not process this event.", 500);
  }
});

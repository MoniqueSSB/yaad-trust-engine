/* ── yaad-pay ───────────────────────────────────────────────────────────────
 *
 * The one-click "Pay this invoice by card" link in an emailed invoice.
 *
 * WHY. Founder, 14 Sep 2026: the invoice should give the client a direct link
 * to pay Yaadly the amount, without signing in first. A Stripe Checkout page
 * expires within 24 hours, so a page baked into an email would be dead the
 * next day. The email carries this endpoint instead; each tap makes a fresh
 * Stripe page for exactly the invoice's total and redirects to it.
 *
 * THE TOKEN IS THE ONLY DOOR. Runs with --no-verify-jwt, because the person
 * tapping the link holds no session. The link is yaad-pay?i=<invoice>&t=<hmac>
 * and the HMAC is checked first (_shared/stripe.ts, keyed on the service role
 * key, which yaad-invoice uses to sign). A wrong or missing token gets the
 * same "not valid" page as an unknown invoice, so it cannot be used to learn
 * which invoice numbers exist.
 *
 * WHAT IT CHECKS, the same as yaad-checkout: Yaadly's own client invoice, sent
 * and unpaid, a currency card payment is set up for, and no card payment
 * already recorded for it. Paid, void or draft invoices get a page saying so,
 * never a payment page.
 *
 * WHAT IT NEVER DOES. It does not mark anything paid and does not start a
 * job. Stripe's confirmation reaches yaad-stripe-webhook, which records it;
 * a named person marks the invoice paid at the desk. CLAUDE.md §2, §3, §9.
 *
 * LIVE KEYS are refused unless STRIPE_ALLOW_LIVE is exactly "yes", as in
 * yaad-checkout.
 *
 * The thank-you and cancelled pages are served from here, because the client
 * is not signed in and the portal would only show them its sign-in page.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { httpAttrs, SpanKind, Trace } from "./otel.ts";
import { buildCheckoutForm, isLiveKey, STRIPE_CURRENCIES, toStripeAmount, verifyPayLinkToken } from "./stripe.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SELF = `${SUPABASE_URL}/functions/v1/yaad-pay`;

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

function page(title: string, message: string, status: number): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)} · Yaadly</title>
<style>body{margin:0;font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;background:#0d0d28;color:#f1f0fa;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
.card{max-width:480px;width:100%;background:#16163a;border:1px solid #2c2c5c;border-radius:18px;padding:28px}
.mark{font-weight:800;letter-spacing:.04em;color:#c9a227;margin-bottom:14px}h1{font-size:21px;margin:0 0 10px}p{margin:0;color:#c9c8e0}</style></head>
<body><div class="card"><div class="mark">YAADLY.</div><h1>${esc(title)}</h1><p>${esc(message)}</p></div></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

Deno.serve(async (req: Request) => {
  const trace = new Trace("yaad-pay", req);
  const root = trace.startSpan(`${req.method} /yaad-pay`, SpanKind.SERVER, httpAttrs(req));
  const finish = (r: Response) => {
    root.setAttributes({ "http.response.status_code": r.status });
    root.end(); trace.flush();
    return r;
  };
  const notValid = () => finish(page("This payment link is not valid", "Please use the link in your invoice email as it was sent, or pay from your job page on app.yaadly.co.uk.", 404));

  if (req.method !== "GET") return finish(page("Not available", "Open the link from your invoice email.", 405));
  if (!SUPABASE_URL || !SERVICE_KEY) return finish(page("Not available right now", "Card payment is not available right now. Please try again later.", 500));

  try {
    const u = new URL(req.url);
    const id = (u.searchParams.get("i") ?? "").trim();
    const token = (u.searchParams.get("t") ?? "").trim();
    if (!id || !token || !(await verifyPayLinkToken(id, token, SERVICE_KEY))) return notValid();
    root.setAttributes({ "yaadly.invoice.id": id });

    // Stripe sends the client back here; both pages are fixed text.
    if (u.searchParams.get("done") === "1") {
      return finish(page("Thank you", `Your card payment for invoice ${id} is going through. Yaadly confirms it and marks the invoice paid. You can close this page.`, 200));
    }
    if (u.searchParams.get("cancelled") === "1") {
      return finish(page("Payment cancelled", `Nothing was charged. The link in your invoice ${id} still works whenever you are ready.`, 200));
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
    if (!stripeKey) return finish(page("Card payment is not switched on yet", "Please pay by bank transfer, using the details on your invoice.", 503));
    if (isLiveKey(stripeKey) && Deno.env.get("STRIPE_ALLOW_LIVE") !== "yes") {
      console.error("yaad-pay: a LIVE Stripe key is set but STRIPE_ALLOW_LIVE is not 'yes'. Refusing.");
      return finish(page("Card payment is not switched on yet", "Please pay by bank transfer, using the details on your invoice.", 503));
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: inv, error: invErr } = await admin
      .from("invoices")
      .select("id, job_id, status, payable_to, currency, total_pence, client_email")
      .eq("id", id)
      .maybeSingle();
    if (invErr) return finish(page("Not available right now", "Your invoice could not be read just now. Please try again in a moment.", 502));
    if (!inv || inv.payable_to === "worker") return notValid();
    if (inv.status === "paid") return finish(page("Already paid", `Invoice ${id} is already paid. Thank you.`, 200));
    if (inv.status === "void") return finish(page("This invoice was cancelled", `Invoice ${id} has been cancelled, so there is nothing to pay on it. If you have a newer invoice, use the link in that one.`, 200));
    if (inv.status !== "sent") return notValid();

    const currency = String(inv.currency ?? "").toUpperCase();
    if (!(STRIPE_CURRENCIES as readonly string[]).includes(currency)) {
      return finish(page("Pay by bank transfer", "Card payment is not set up for this invoice's currency. Please pay by bank transfer, using the details on your invoice.", 409));
    }
    let unitAmount: number;
    try {
      unitAmount = toStripeAmount(Number(inv.total_pence), currency);
    } catch {
      return finish(page("Pay by bank transfer", "This invoice cannot be paid by card. Please pay by bank transfer, using the details on your invoice.", 409));
    }

    // One card payment per invoice, the same rule as yaad-checkout.
    const { data: already } = await admin
      .from("invoice_payments").select("id").eq("invoice_id", inv.id).eq("status", "succeeded").limit(1);
    if (already && already.length) {
      return finish(page("Card payment received", `A card payment for invoice ${id} has already been received. Yaadly is confirming it. There is nothing more to pay.`, 200));
    }

    const back = `${SELF}?i=${encodeURIComponent(id)}&t=${encodeURIComponent(token)}`;
    const form = buildCheckoutForm({
      invoiceId: inv.id,
      jobId: inv.job_id ?? null,
      email: String(inv.client_email ?? "").trim().toLowerCase(),
      currency,
      unitAmount,
      successUrl: `${back}&done=1`,
      cancelUrl: `${back}&cancelled=1`,
    });

    const res = await trace.span("stripe.checkout.sessions.create", SpanKind.CLIENT, { "server.address": "api.stripe.com" }, async (s) => {
      const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${stripeKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
          // A double tap inside ten minutes gets the same page, not two.
          "Idempotency-Key": `yaadly-paylink-${inv.id}-${unitAmount}-${Math.floor(Date.now() / 600000)}`,
        },
        body: form.toString(),
        signal: AbortSignal.timeout(15000),
      });
      s.setAttributes({ "http.response.status_code": r.status });
      return r;
    });
    const session = await res.json().catch(() => ({}));
    if (!res.ok || !session?.url) {
      console.error(`yaad-pay: Stripe refused a session for ${inv.id}: ${String(session?.error?.message ?? res.status).slice(0, 300)}`);
      return finish(page("Card payment could not be started", "Please try the link again in a moment, or pay by bank transfer using the details on your invoice.", 502));
    }
    if (!/^https:\/\/checkout\.stripe\.com\//.test(String(session.url))) {
      return finish(page("Card payment could not be started", "Please try the link again in a moment, or pay by bank transfer using the details on your invoice.", 502));
    }

    root.setAttributes({ "yaadly.pay.session": String(session.id ?? "") });
    return finish(new Response(null, { status: 303, headers: { Location: String(session.url), "Cache-Control": "no-store" } }));
  } catch (e) {
    console.error("yaad-pay: threw:", String(e).slice(0, 300));
    root.recordError(e);
    return finish(page("Card payment could not be started", "Please try the link again in a moment, or pay by bank transfer using the details on your invoice.", 500));
  }
});

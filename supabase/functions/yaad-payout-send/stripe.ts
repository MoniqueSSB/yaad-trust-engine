/**
 * Stripe, shared by yaad-checkout (makes a card payment page for one invoice)
 * and yaad-stripe-webhook (hears that it was paid).
 *
 * Phase 1 of card payment, founder's instruction, 14 Sep 2026: the client
 * pays an invoice by card from the portal. A payment is RECORDED from Stripe;
 * a named person still marks the invoice paid, because paying the invoice
 * that starts a job is what starts the job (CLAUDE.md §2). Nothing in this
 * file, or in either function that imports it, writes invoices.status.
 *
 * AMOUNTS. Yaadly stores J$ invoices in WHOLE dollars despite the *_pence
 * column names (J$134,250 is 134250), and GBP, USD and CAD in pence or
 * cents. Stripe wants every one of these in minor units, and to Stripe JMD
 * is an ordinary two-decimal currency. So J$134,250 is 134250 here and
 * 13425000 to Stripe. Getting this backwards charges a client a hundredth,
 * or a hundred times, of their bill, so it lives in exactly one place.
 */

export const STRIPE_CURRENCIES = ["JMD", "GBP", "USD", "CAD"] as const;

/** A stored invoice total, in the minor units Stripe expects. */
export function toStripeAmount(stored: number, currency: string): number {
  const cur = String(currency ?? "").toUpperCase();
  if (!Number.isInteger(stored) || stored <= 0) {
    throw new Error("An invoice total must be a positive whole number.");
  }
  if (cur === "JMD") return stored * 100;
  if (cur === "GBP" || cur === "USD" || cur === "CAD") return stored;
  throw new Error(`Card payment is not set up for ${currency || "an invoice with no currency"}.`);
}

/** What Stripe reports, back in Yaadly's stored units for that currency. */
export function fromStripeAmount(minor: number, currency: string): number {
  return String(currency ?? "").toUpperCase() === "JMD" ? Math.round(minor / 100) : minor;
}

/** A live secret or restricted key. Phase 1 runs on test keys only. */
export function isLiveKey(key: string): boolean {
  return /^(sk|rk)_live_/.test(key);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
  return Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Stripe's webhook signature: header "t=<unix seconds>,v1=<hex>[,v1=...]",
 * where v1 is HMAC-SHA256 of "<t>.<raw body>" under the endpoint's secret.
 *
 * checked = false means there was no secret to check against. The caller
 * must refuse that (503), never wave it through: an endpoint that cannot
 * tell who is calling does not get a development mode. Same rule as
 * yaad-inbound and yaad-message-status.
 */
export async function checkStripeSignature(
  raw: string,
  header: string | null,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  toleranceSeconds = 300,
): Promise<{ checked: boolean; ok: boolean; reason?: string }> {
  if (!secret) return { checked: false, ok: false, reason: "no secret configured" };
  if (!header) return { checked: true, ok: false, reason: "no signature header" };

  let t = "";
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t") t = v;
    else if (k === "v1") v1.push(v);
  }
  const ts = Number(t);
  if (!t || !Number.isFinite(ts) || v1.length === 0) {
    return { checked: true, ok: false, reason: "malformed signature header" };
  }
  if (Math.abs(nowSeconds - ts) > toleranceSeconds) {
    return { checked: true, ok: false, reason: "signature too old" };
  }

  const expected = await hmacSha256Hex(secret, `${t}.${raw}`);
  const ok = v1.some((s) => timingSafeEqual(s, expected));
  return { checked: true, ok, reason: ok ? undefined : "signature mismatch" };
}

/**
 * The one-click pay link on an emailed invoice (founder, 14 Sep 2026).
 *
 * The email carries yaad-pay?i=<invoice>&t=<token>. The token is an HMAC of
 * the invoice number under a server secret (yaad-invoice and yaad-pay both
 * pass the project's service role key), so a link opens a payment page for
 * that one invoice and cannot be edited into another invoice's link or
 * guessed. Rotating that key invalidates links in emails already sent; the
 * client then pays from the portal instead. 32 hex characters is 128 bits.
 */
const PAY_LINK_CONTEXT = "yaadly-pay-link:";

export async function payLinkToken(invoiceId: string, secret: string): Promise<string> {
  if (!secret) throw new Error("No secret to sign a pay link with.");
  if (!invoiceId) throw new Error("No invoice to sign a pay link for.");
  return (await hmacSha256Hex(secret, PAY_LINK_CONTEXT + invoiceId)).slice(0, 32);
}

export async function verifyPayLinkToken(invoiceId: string, token: string, secret: string): Promise<boolean> {
  if (!secret || !invoiceId || !/^[0-9a-f]{32}$/.test(token)) return false;
  return timingSafeEqual(token, await payLinkToken(invoiceId, secret));
}

/**
 * The Stripe Checkout Session for one invoice, as a form. Shared by
 * yaad-checkout (the portal button, signed in) and yaad-pay (the email link,
 * not signed in) so both ask Stripe for exactly the same thing: one line for
 * exactly the invoice's total, the invoice number on the session and on the
 * payment itself, so yaad-stripe-webhook can tie the payment back to it.
 */
export function buildCheckoutForm(p: {
  invoiceId: string;
  jobId: string | null;
  email: string;
  currency: string;
  unitAmount: number;
  successUrl: string;
  cancelUrl: string;
}): URLSearchParams {
  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("line_items[0][quantity]", "1");
  form.set("line_items[0][price_data][currency]", p.currency.toLowerCase());
  form.set("line_items[0][price_data][unit_amount]", String(p.unitAmount));
  form.set("line_items[0][price_data][product_data][name]", `Yaadly invoice ${p.invoiceId}`);
  if (p.jobId) form.set("line_items[0][price_data][product_data][description]", `Job ${p.jobId}`);
  if (p.email) form.set("customer_email", p.email);
  form.set("client_reference_id", p.invoiceId);
  form.set("metadata[invoice_id]", p.invoiceId);
  form.set("payment_intent_data[metadata][invoice_id]", p.invoiceId);
  if (p.jobId) {
    form.set("metadata[job_id]", p.jobId);
    form.set("payment_intent_data[metadata][job_id]", p.jobId);
  }
  form.set("success_url", p.successUrl);
  form.set("cancel_url", p.cancelUrl);
  return form;
}

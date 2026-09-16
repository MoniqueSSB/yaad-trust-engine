/* ── yaad-payout-send ───────────────────────────────────────────────────────
 *
 * A named person on the desk pays a worker through Stripe Global Payouts.
 *
 * WHY. Founder, 16 Sep 2026: "build this out". Stripe confirmed the corridor
 * (worker receives J$, Stripe converts from GBP, fees fall on Yaadly, 1 to 7
 * business days), Global Payouts is enabled on the account, and Jamaica is
 * offered as a recipient country. Yaadly is the principal: it engages and
 * pays the tradesperson for work done for Yaadly. This is Yaadly paying its
 * own subcontractor, never a client's money passed on.
 *
 * WHAT IT DOES. A signed-in ADMIN posts { action, invoice }.
 *   "quote"    Reads the invoice, the worker's Stripe recipient, Yaadly's
 *              financial account and its GBP balance, and asks Stripe for a
 *              quote: the fees, the exchange rate, what the worker receives
 *              and what leaves the account. Returns all of that for a person
 *              to read. Moves nothing.
 *   "send"     Only with { quote_id | estimate: true, acknowledged: true }
 *              from the desk's second click. Re-reads everything, refuses if
 *              anything changed, creates the OutboundPayment, records it in
 *              stripe_payouts, then calls mark_worker_paid WITH THE PERSON'S
 *              OWN SESSION so paid_by is them. That call is the same gate the
 *              bank-transfer path goes through: admin, sent, call-back done.
 *   "refresh"  Reads a payout back from Stripe and updates its status.
 *
 * WHAT IT NEVER DOES. Send without a person's second click. Send on a timer,
 * on evidence passing, or because a quote looked fine. Touch a bank detail:
 * the worker typed theirs into Stripe's form; Yaadly holds only Stripe's ids.
 * Pay anybody whose bank details have not been checked by phone.
 *
 * LIVE KEYS ARE REFUSED unless STRIPE_PAYOUTS_ALLOW_LIVE is exactly "yes",
 * the same switch yaad-payout-setup uses, separate from card payments.
 *
 * Runs with the platform's JWT check ON (verify_jwt = true). Admin is decided
 * by the database's is_admin() under the caller's own token, the same way
 * yaad-invoice decides it.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { httpAttrs, SpanKind, Trace } from "./otel.ts";
import { isLiveKey, toStripeAmount } from "./stripe.ts";
import {
  availableGbp,
  DEFAULT_STRIPE_V2_VERSION,
  estimateSummary,
  paymentBody,
  pickFinancialAccount,
  pickPayoutMethod,
  moneyBody,
  quoteUnavailable,
  recipientReady,
  statusFromPayout,
  summariseQuote,
} from "./payout_send.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const V2_VERSION = Deno.env.get("STRIPE_V2_VERSION") || DEFAULT_STRIPE_V2_VERSION;
const FIXED_FA = Deno.env.get("STRIPE_FINANCIAL_ACCOUNT") ?? "";
const NOT_NOW = "Paying by Stripe is not available right now. Pay from Wise as usual, or try again shortly.";

Deno.serve(async (req: Request) => {
  const trace = new Trace("yaad-payout-send", req);
  const root = trace.startSpan(`${req.method} /yaad-payout-send`, SpanKind.SERVER, httpAttrs(req));
  const done = (body: unknown, status: number) => {
    root.setAttributes({ "http.response.status_code": status });
    root.end(); trace.flush();
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  };
  const fail = (error: string, status: number, extra: Record<string, unknown> = {}) => done({ error, ...extra }, status);

  if (req.method !== "POST") return fail("POST only.", 405);
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) return fail("Not configured.", 500);

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  if (!stripeKey) return fail("Card payments and payouts are not switched on yet (no Stripe key).", 503);
  const live = isLiveKey(stripeKey);
  if (live && Deno.env.get("STRIPE_PAYOUTS_ALLOW_LIVE") !== "yes") {
    console.error("yaad-payout-send: a LIVE Stripe key is set but STRIPE_PAYOUTS_ALLOW_LIVE is not 'yes'. Refusing.");
    return fail("Stripe payouts are in test mode only. The live switch has not been turned on.", 503);
  }
  root.setAttributes({ "yaadly.payout.livemode": live });

  // One place that talks to Stripe's v2 API. JSON in and out, preview version.
  const stripe = (method: "GET" | "POST", path: string, body?: unknown, opts: { idempotencyKey?: string; context?: string } = {}) =>
    trace.span(`stripe ${method} ${path.split("?")[0].replace(/\/(acct|obp|obpq|fa)_[A-Za-z0-9_]+/g, "/{id}")}`, SpanKind.CLIENT, { "server.address": "api.stripe.com" }, async (s) => {
      const headers: Record<string, string> = { Authorization: `Bearer ${stripeKey}`, "Stripe-Version": V2_VERSION };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
      if (opts.context) headers["Stripe-Context"] = opts.context;
      const r = await fetch(`https://api.stripe.com${path}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000),
      });
      s.setAttributes({ "http.response.status_code": r.status });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) console.error(`yaad-payout-send: Stripe ${method} ${path.split("?")[0]} answered ${r.status}: ${String(out?.error?.code ?? "")} ${String(out?.error?.message ?? "").slice(0, 300)}`);
      return { ok: r.ok, status: r.status, body: out };
    });
  const stripeMessage = (r: { body: { error?: { code?: string; message?: string } } }) =>
    String(r.body?.error?.message ?? "Stripe refused.").slice(0, 300);

  try {
    const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    // Two clients, on purpose. `me` acts as the signed-in person: it decides
    // admin and it is what marks the invoice paid, so paid_by is them.
    // `admin` is the service role, used only to read across tables and to
    // write the stripe_payouts record, which nobody else may write.
    const me = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: who, error: whoErr } = await admin.auth.getUser(jwt);
    const email = (who?.user?.email ?? "").trim().toLowerCase();
    if (whoErr || !email) return fail("Sign in again, then try.", 401);
    const { data: isAdmin } = await me.rpc("is_admin");
    if (isAdmin !== true) return fail("Admin only.", 403);
    root.setAttributes({ "yaadly.payout.by": email });

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");
    if (!["quote", "send", "refresh"].includes(action)) return fail("action must be quote, send or refresh.", 400);
    const invoiceId = String(body?.invoice ?? "").trim();
    if (!invoiceId) return fail("Say which invoice.", 400);
    root.setAttributes({ "yaadly.payout.action": action, "yaadly.invoice.id": invoiceId });

    // ---------------------------------------------------------- refresh
    if (action === "refresh") {
      const { data: rec } = await admin.from("stripe_payouts").select("id, outbound_payment_id, status").eq("invoice_id", invoiceId).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!rec?.outbound_payment_id) return fail("No Stripe payout is recorded for that invoice.", 404);
      const got = await stripe("GET", `/v2/money_management/outbound_payments/${encodeURIComponent(rec.outbound_payment_id)}`);
      if (!got.ok) return fail(`Stripe could not be read: ${stripeMessage(got)}`, 502);
      const st = statusFromPayout(got.body);
      await admin.from("stripe_payouts").update({
        status: st.status, status_detail: st.detail, receipt_url: st.receipt_url, trace_id: st.trace_id,
        expected_arrival: st.expected_arrival, debited_value: st.debited?.value ?? null, debited_currency: st.debited?.currency ?? null,
        updated_at: new Date().toISOString(),
      }).eq("id", rec.id);
      root.setAttributes({ "yaadly.payout.status": st.status });
      return done({ ok: true, ...st }, 200);
    }

    // ---------------------------------------------------------- the invoice
    const { data: inv, error: invErr } = await admin.from("invoices")
      .select("id, job_id, status, payable_to, currency, total_pence, worker_email, stage, period_label, paid_method")
      .eq("id", invoiceId).maybeSingle();
    if (invErr || !inv) return fail("No such invoice.", 404);
    if (inv.payable_to !== "worker") return fail(`${inv.id} is a client's bill, not a worker's pay.`, 409);
    if (inv.status !== "sent") return fail(`${inv.id} is ${inv.status}, not sent, so nothing is owed on it${inv.status === "paid" ? " any more" : " yet"}.`, 409);
    const workerEmail = String(inv.worker_email ?? "").trim().toLowerCase();
    if (!workerEmail) return fail(`${inv.id} has no worker on it.`, 409);
    const currency = String(inv.currency ?? "JMD").toUpperCase();
    if (currency !== "JMD") return fail(`${inv.id} is in ${currency}. Stripe payouts to Jamaica are made in J$ only.`, 409);
    const amountMinor = toStripeAmount(Number(inv.total_pence ?? 0), currency);
    if (!(amountMinor > 0)) return fail(`${inv.id} has no amount on it.`, 409);
    const what = String(inv.period_label ?? "").trim() || (inv.stage ? `stage ${inv.stage}` : "work completed");

    // Already paid through Stripe? The idempotency key below would return the
    // same payout, but say it plainly rather than lean on that.
    const { data: prior } = await admin.from("stripe_payouts").select("outbound_payment_id, status, created_at").eq("invoice_id", inv.id).in("status", ["processing", "posted"]).limit(1).maybeSingle();
    if (prior?.outbound_payment_id) {
      return fail(`${inv.id} already has a Stripe payout (${prior.outbound_payment_id}, ${prior.status}) from ${String(prior.created_at).slice(0, 10)}. If the invoice still shows unpaid, press Mark as paid by Stripe rather than sending again.`, 409, { outbound_payment_id: prior.outbound_payment_id });
    }

    // ---------------------------------------------------------- the worker
    const { data: wp } = await admin.from("worker_profiles")
      .select("name, stripe_recipient_id, stripe_recipient_status, bank_callback_at")
      .ilike("worker_email", workerEmail).not("stripe_recipient_id", "is", null)
      .order("updated_at", { ascending: false }).limit(1).maybeSingle();
    const recipient = String(wp?.stripe_recipient_id ?? "");
    if (!recipient) return fail(`${wp?.name ?? workerEmail} has not set up Stripe yet. Their portal page "How Yaadly pays you" has the button. Pay them from Wise in the meantime.`, 409);
    // The same gate mark_worker_paid enforces, checked here first so a payout
    // can never go out and then fail to be recorded against the invoice.
    const { data: checked } = await admin.rpc("worker_bank_checked", { p_worker_email: workerEmail });
    if (checked !== true) return fail(`Call ${wp?.name ?? workerEmail} back on the number you have for them, check their bank details, and press Call-back done on Pay workers first.`, 409);

    const acct = await stripe("GET", `/v2/core/accounts/${encodeURIComponent(recipient)}?include=configuration.recipient`);
    if (!acct.ok) return fail(`Stripe could not read the worker's recipient record: ${stripeMessage(acct)}`, 502);
    if (!recipientReady(acct.body)) {
      await admin.from("worker_profiles").update({ stripe_recipient_status: "needs_info", stripe_recipient_checked_at: new Date().toISOString() }).ilike("worker_email", workerEmail);
      return fail(`Stripe says ${wp?.name ?? workerEmail} still needs to finish their Stripe setup before they can be paid. Ask them to open "How Yaadly pays you" in their portal.`, 409);
    }
    let payoutMethod = pickPayoutMethod(acct.body, []);
    if (!payoutMethod) {
      const pms = await stripe("GET", `/v2/money_management/payout_methods?limit=10`, undefined, { context: recipient });
      payoutMethod = pms.ok ? pickPayoutMethod(acct.body, pms.body?.data ?? []) : null;
    }
    if (!payoutMethod) return fail(`Stripe has no bank account on file for ${wp?.name ?? workerEmail} that it can pay. Ask them to open "How Yaadly pays you" in their portal.`, 409);

    // ---------------------------------------------------------- the account
    let fa: Record<string, unknown> | null = null;
    if (FIXED_FA) {
      const one = await stripe("GET", `/v2/money_management/financial_accounts/${encodeURIComponent(FIXED_FA)}`);
      fa = one.ok ? one.body : null;
    } else {
      const all = await stripe("GET", `/v2/money_management/financial_accounts`);
      fa = all.ok ? pickFinancialAccount(all.body?.data ?? []) : null;
    }
    const financialAccount = typeof fa?.id === "string" ? fa.id : "";
    if (!financialAccount) return fail("Yaadly's Stripe financial account could not be found. Check Stripe, Global Payouts.", 502);
    const balance = availableGbp(fa);

    const money = { financialAccount, recipient, payoutMethod, amountMinor, currency };

    // ---------------------------------------------------------- quote
    const q = await stripe("POST", "/v2/money_management/outbound_payment_quotes", moneyBody(money));
    let summary;
    if (q.ok) summary = summariseQuote(q.body);
    else if (quoteUnavailable(q.status, q.body)) summary = estimateSummary(amountMinor, currency);
    else return fail(`Stripe would not quote this payout: ${stripeMessage(q)}`, 502, { stripe_code: q.body?.error?.code ?? null });

    const facts = {
      invoice: inv.id, job_id: inv.job_id, what, worker: wp?.name ?? workerEmail, worker_email: workerEmail,
      recipient, payout_method: payoutMethod, financial_account: financialAccount,
      balance_available_gbp_pence: balance, livemode: live, ...summary,
      enough: summary.debited && balance != null ? balance >= summary.debited.value : null,
    };

    if (action === "quote") {
      root.setAttributes({ "yaadly.payout.estimate": summary.estimate });
      return done({ ok: true, ...facts }, 200);
    }

    // ---------------------------------------------------------- send
    // The desk's second click. It must carry what the person saw: the quote
    // id, or an explicit acceptance that only an estimate was available.
    if (body?.acknowledged !== true) return fail("Send needs the person's acknowledgement of the quote.", 400);
    const quoteId = summary.estimate ? null : summary.quote_id;
    if (!summary.estimate && String(body?.quote_id ?? "") !== String(quoteId ?? "")) {
      // The rate moved or five minutes passed and a fresh quote came back.
      return fail("The quote changed since you read it. Look at the new figures and press Pay with Stripe again.", 409, { ...facts });
    }
    if (summary.estimate && body?.estimate !== true) return fail("Stripe gave no quote; the desk must say the estimate was accepted.", 409, { ...facts });
    if (facts.enough === false) return fail(`Not enough GBP in Yaadly's Stripe account: £${((balance ?? 0) / 100).toFixed(2)} available, £${((summary.debited?.value ?? 0) / 100).toFixed(2)} needed. Add money in Stripe, Global Payouts, then try again.`, 409, { ...facts });

    const idem = `yaadly-payout-${inv.id}`;
    const sent = await stripe("POST", "/v2/money_management/outbound_payments", paymentBody({ ...money, invoiceId: inv.id, what, quoteId }), { idempotencyKey: idem });
    if (!sent.ok || typeof sent.body?.id !== "string") {
      return fail(`Stripe refused the payout: ${stripeMessage(sent)}`, 502, { stripe_code: sent.body?.error?.code ?? null });
    }
    const st = statusFromPayout(sent.body);
    const obp = String(sent.body.id);
    root.setAttributes({ "yaadly.payout.id": obp, "yaadly.payout.status": st.status });

    // Record first. Money has moved; this row is what the desk and the invoice
    // gate lean on, so its failure is loud and the payout id is returned anyway.
    const { error: recErr } = await admin.from("stripe_payouts").insert({
      invoice_id: inv.id, job_id: inv.job_id, worker_email: workerEmail, recipient_id: recipient, payout_method_id: payoutMethod,
      financial_account: financialAccount, amount_value: amountMinor, amount_currency: currency,
      debited_value: st.debited?.value ?? summary.debited?.value ?? null, debited_currency: st.debited?.currency ?? summary.debited?.currency ?? null,
      fees: summary.fees, fx_rate: summary.fx_rate, quote_id: quoteId, quote_is_estimate: summary.estimate,
      outbound_payment_id: obp, status: st.status, status_detail: st.detail, receipt_url: st.receipt_url, trace_id: st.trace_id,
      expected_arrival: st.expected_arrival, livemode: live, sent_by: email,
    });
    if (recErr) {
      console.error(`yaad-payout-send: payout ${obp} went out for ${inv.id} but could not be recorded: ${recErr.message}`);
      return fail(`The payout WENT OUT (Stripe id ${obp}) but could not be recorded here. Do not send again. Note the id and tell Yaadly's developer.`, 500, { outbound_payment_id: obp });
    }

    // The same gate as the bank-transfer path, under the person's own session.
    const { data: paidAt, error: markErr } = await me.rpc("mark_worker_paid", { p_invoice: inv.id, p_method: "stripe", p_ref: obp });
    if (markErr) {
      console.error(`yaad-payout-send: payout ${obp} recorded for ${inv.id} but mark_worker_paid refused: ${markErr.message}`);
      return fail(`The payout went out (Stripe id ${obp}) and is recorded, but the invoice could not be marked paid: ${markErr.message}`, 500, { outbound_payment_id: obp });
    }
    return done({ ok: true, outbound_payment_id: obp, status: st.status, paid_at: paidAt, receipt_url: st.receipt_url, expected_arrival: st.expected_arrival, ...facts }, 200);
  } catch (e) {
    console.error("yaad-payout-send: threw:", String(e).slice(0, 300));
    root.recordError(e);
    return fail(NOT_NOW, 500);
  }
});

/* ── yaad-payout-setup ──────────────────────────────────────────────────────
 *
 * A worker sets up how Yaadly pays them, on Stripe's own form.
 *
 * WHY. Founder, 14 Sep 2026: Yaadly does not store worker bank details, and
 * "make this live" for Stripe Global Payouts, the route that avoids them.
 * The worker types their bank details into Stripe's hosted form. Stripe keeps
 * them. Yaadly keeps only Stripe's reference for the worker and whether they
 * are ready (worker_profiles.stripe_recipient_*, 20260914200000).
 *
 * WHAT IT DOES. A signed-in worker posts { action }.
 *   "start"   Makes the worker a Stripe recipient if they are not one yet
 *             (a person in Jamaica, paid in J$ to a local bank), then asks
 *             Stripe for a one-time sign-up link and returns it. The link is
 *             single use and lasts ten minutes, and Stripe says never to text
 *             or email it, so it is only ever handed to the signed-in worker
 *             here, never put in a WhatsApp.
 *   "status"  Reads the recipient back from Stripe and records whether local
 *             bank payouts are active.
 *
 * WHAT IT NEVER DOES. It sends no money and it never sees a bank detail.
 * Paying a worker is a later piece, and a named person's click (CLAUDE.md §2).
 *
 * LIVE KEYS ARE REFUSED unless STRIPE_PAYOUTS_ALLOW_LIVE is exactly "yes",
 * its own switch, separate from card payments' STRIPE_ALLOW_LIVE: taking card
 * payments live must not quietly start onboarding real payout recipients.
 *
 * Runs with the platform's JWT check ON (verify_jwt = true), called server
 * side from the worker portal with the worker's own session token.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { httpAttrs, SpanKind, Trace } from "./otel.ts";
import { isLiveKey } from "./stripe.ts";
import { DEFAULT_STRIPE_V2_VERSION, isStripeHostedUrl, recipientBody, recipientState } from "./payout.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const APP_URL = (Deno.env.get("YAADLY_APP_URL") ?? "https://app.yaadly.co.uk").replace(/\/+$/, "");
const V2_VERSION = Deno.env.get("STRIPE_V2_VERSION") || DEFAULT_STRIPE_V2_VERSION;
const NOT_NOW = "Setting up payment is not available right now. Try again later, or ask Yaadly.";

Deno.serve(async (req: Request) => {
  const trace = new Trace("yaad-payout-setup", req);
  const root = trace.startSpan(`${req.method} /yaad-payout-setup`, SpanKind.SERVER, httpAttrs(req));
  const done = (body: unknown, status: number) => {
    root.setAttributes({ "http.response.status_code": status });
    root.end(); trace.flush();
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  };
  const fail = (error: string, status: number) => done({ error }, status);

  if (req.method !== "POST") return fail("POST only.", 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return fail("Not configured.", 500);

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  if (!stripeKey) return fail(NOT_NOW, 503);
  if (isLiveKey(stripeKey) && Deno.env.get("STRIPE_PAYOUTS_ALLOW_LIVE") !== "yes") {
    console.error("yaad-payout-setup: a LIVE Stripe key is set but STRIPE_PAYOUTS_ALLOW_LIVE is not 'yes'. Refusing.");
    return fail("Payment setup is in test mode only.", 503);
  }
  root.setAttributes({ "yaadly.payout.livemode": isLiveKey(stripeKey) });

  // One place that talks to Stripe's v2 API. JSON in and out, preview version.
  const stripe = (method: "GET" | "POST", path: string, body?: unknown, idempotencyKey?: string) =>
    trace.span(`stripe ${method} ${path.split("?")[0].replace(/acct_[A-Za-z0-9]+/, "{id}")}`, SpanKind.CLIENT, { "server.address": "api.stripe.com" }, async (s) => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${stripeKey}`,
        "Stripe-Version": V2_VERSION,
      };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
      const r = await fetch(`https://api.stripe.com${path}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000),
      });
      s.setAttributes({ "http.response.status_code": r.status });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) console.error(`yaad-payout-setup: Stripe ${method} ${path.split("?")[0]} answered ${r.status}: ${String(out?.error?.message ?? "").slice(0, 300)}`);
      return { ok: r.ok, status: r.status, body: out };
    });

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: who, error: whoErr } = await admin.auth.getUser(jwt);
    const email = (who?.user?.email ?? "").trim().toLowerCase();
    if (whoErr || !email) return fail("Sign in again, then try.", 401);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");
    if (action !== "start" && action !== "status") return fail("action must be start or status.", 400);

    // A worker is somebody with a worker profile. More than one row can carry
    // the same email (an old row beside a re-application), so the recipient
    // is looked for across all of them and written to all of them.
    const { data: rows, error: rowsErr } = await admin
      .from("worker_profiles")
      .select("id, name, stripe_recipient_id, stripe_recipient_status")
      .ilike("worker_email", email)
      .order("updated_at", { ascending: false });
    if (rowsErr) return fail(NOT_NOW, 502);
    if (!rows || !rows.length) return fail("Only a Yaadly tradesperson can set up how Yaadly pays them.", 403);
    const worker = rows.find((r) => r.stripe_recipient_id) ?? rows[0];
    let acct: string = worker.stripe_recipient_id ?? "";

    const record = (patch: Record<string, unknown>) =>
      admin.from("worker_profiles").update({ ...patch, stripe_recipient_checked_at: new Date().toISOString() }).ilike("worker_email", email);

    if (action === "status") {
      if (!acct) return done({ state: "none" }, 200);
      const got = await stripe("GET", `/v2/core/accounts/${encodeURIComponent(acct)}?include=configuration.recipient`);
      if (!got.ok) return fail(NOT_NOW, 502);
      const state = recipientState(got.body);
      await record({ stripe_recipient_status: state });
      root.setAttributes({ "yaadly.payout.state": state });
      return done({ state }, 200);
    }

    // start
    if (!acct) {
      const made = await stripe("POST", "/v2/core/accounts", recipientBody(email, String(worker.name ?? "")), `yaadly-recipient-${worker.id}`);
      if (!made.ok || typeof made.body?.id !== "string") return fail(NOT_NOW, 502);
      acct = made.body.id;
      const { error } = await record({ stripe_recipient_id: acct, stripe_recipient_status: "started" });
      if (error) {
        // Stripe has the recipient and Yaadly failed to note it. The same
        // idempotency key returns the same account on the next try, so a
        // retry heals this rather than making a second recipient.
        console.error(`yaad-payout-setup: made ${acct} but could not record it: ${error.message}`);
        return fail(NOT_NOW, 502);
      }
    }

    const already = worker.stripe_recipient_status === "ready";
    const useCase = already ? "account_update" : "account_onboarding";
    const link = await stripe("POST", "/v2/core/account_links", {
      account: acct,
      use_case: {
        type: useCase,
        [useCase]: {
          configurations: ["recipient"],
          refresh_url: `${APP_URL}/portal/worker/payouts?again=1`,
          return_url: `${APP_URL}/portal/worker/payouts?back=1`,
        },
      },
    });
    const url = String(link.body?.url ?? "");
    if (!link.ok || !isStripeHostedUrl(url)) return fail(NOT_NOW, 502);
    root.setAttributes({ "yaadly.payout.use_case": useCase });
    return done({ url }, 200);
  } catch (e) {
    console.error("yaad-payout-setup: threw:", String(e).slice(0, 300));
    root.recordError(e);
    return fail(NOT_NOW, 500);
  }
});

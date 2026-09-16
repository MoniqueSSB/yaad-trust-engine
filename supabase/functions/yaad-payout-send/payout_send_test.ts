// yaad-payout-send: the parts that decide what a person sees before Send and
// what Stripe is asked for. 20260916120000.
//
// Run: deno test supabase/functions/yaad-payout-send/

import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  availableGbp,
  estimateSummary,
  moneyBody,
  paymentBody,
  pickFinancialAccount,
  pickPayoutMethod,
  quoteUnavailable,
  recipientReady,
  statementDescriptor,
  statusFromPayout,
  summariseQuote,
} from "./payout_send.ts";

Deno.test("the financial account is the open GBP storage account, nothing else", () => {
  const fa = { id: "fa_1", status: "open", type: "storage", storage: { holds_currencies: ["gbp"] }, balance: { available: { gbp: { value: 12345 } } } };
  assertEquals(pickFinancialAccount([{ id: "fa_0", status: "closed", type: "storage", storage: { holds_currencies: ["gbp"] } }, fa])?.id, "fa_1");
  assertEquals(pickFinancialAccount([{ id: "fa_2", status: "open", type: "storage", storage: { holds_currencies: ["usd"] } }]), null);
  assertEquals(pickFinancialAccount([]), null);
  assertEquals(availableGbp(fa), 12345);
  assertEquals(availableGbp({}), null);
});

Deno.test("the payout method is Stripe's default, else the first usable bank account, else nothing", () => {
  const acct = { configuration: { recipient: { default_outbound_destination: { id: "jmba_default" } } } };
  assertEquals(pickPayoutMethod(acct, [{ id: "jmba_other" }]), "jmba_default");
  assertEquals(pickPayoutMethod({}, [
    { id: "card_1", type: "card" },
    { id: "jmba_bad", type: "bank_account", usage_status: { payments: "invalid" } },
    { id: "jmba_ok", type: "bank_account", usage_status: { payments: "eligible" } },
  ]), "jmba_ok");
  assertEquals(pickPayoutMethod({}, []), null);
});

Deno.test("a recipient is payable only when local bank payouts are active", () => {
  const acct = (status: string) => ({ configuration: { recipient: { capabilities: { bank_accounts: { local: { status } } } } } });
  assert(recipientReady(acct("active")));
  assert(!recipientReady(acct("pending")));
  assert(!recipientReady({}));
});

Deno.test("the quote and the payment ask for the same money, in the worker's currency, from GBP", () => {
  const p = { financialAccount: "fa_1", recipient: "acct_w", payoutMethod: "jmba_1", amountMinor: 19500, currency: "JMD" };
  const q = moneyBody(p);
  assertEquals(q, { from: { financial_account: "fa_1", currency: "gbp" }, to: { recipient: "acct_w", payout_method: "jmba_1", currency: "jmd" }, amount: { value: 19500, currency: "jmd" } });
  const pay = paymentBody({ ...p, invoiceId: "INV-2026-0005", what: "Mobilization and assessment", quoteId: "obpq_1" });
  assertEquals(pay.from, q.from);
  assertEquals(pay.to, q.to);
  assertEquals(pay.amount, q.amount);
  assertEquals(pay.outbound_payment_quote, "obpq_1");
  assertEquals(pay.recipient_notification, { setting: "none" });
  assertEquals(pay.statement_descriptor, "YAADLY INV-2026-0005");
  assertEquals(pay.metadata, { yaadly_invoice: "INV-2026-0005" });
  const noQuote = paymentBody({ ...p, invoiceId: "INV-2026-0005", what: "x", quoteId: null });
  assert(!("outbound_payment_quote" in noQuote));
});

Deno.test("the statement descriptor fits a bank statement", () => {
  assertEquals(statementDescriptor("INV-2026-0005").length, 20);
  assert(statementDescriptor("INV-2026-0005-PART-OF-A-VERY-LONG-ID").length <= 22);
  assertEquals(statementDescriptor("£!"), "YAADLY");
});

Deno.test("a Stripe quote is reduced to fees, rate, credited and debited", () => {
  const s = summariseQuote({
    id: "obpq_1",
    estimated_fees: [
      { amount: { value: 50, currency: "gbp" }, type: "standard_payout_fee" },
      { amount: { value: 47, currency: "gbp" }, type: "cross_border_payout_fee" },
      { amount: { value: 190, currency: "gbp" }, type: "foreign_exchange_fee" },
    ],
    from: { debited: { value: 9500, currency: "gbp" } },
    to: { credited: { value: 19500, currency: "jmd" } },
    fx_quote: { lock_expires_at: "2026-09-16T10:05:00.000Z", rates: { gbp: { exchange_rate: "205.26" } } },
  });
  assertEquals(s.quote_id, "obpq_1");
  assertEquals(s.fees.length, 3);
  assertEquals(s.fees_total, { value: 287, currency: "GBP" });
  assertEquals(s.fx_rate, "205.26");
  assertEquals(s.credited, { value: 19500, currency: "JMD" });
  assertEquals(s.debited, { value: 9500, currency: "GBP" });
  assertEquals(s.expires_at, "2026-09-16T10:05:00.000Z");
  assert(!s.estimate);
});

Deno.test("when Stripe will not quote, the person sees an estimate labelled as one", () => {
  const e = estimateSummary(19500, "JMD");
  assert(e.estimate);
  assertEquals(e.quote_id, null);
  assertEquals(e.fx_rate, null);
  assertEquals(e.credited, { value: 19500, currency: "JMD" });
  assert(quoteUnavailable(404, {}));
  assert(quoteUnavailable(400, { error: { code: "not_found" } }));
  assert(!quoteUnavailable(400, { error: { code: "insufficient_funds" } }));
});

Deno.test("a payout's status is read back honestly, including why it failed", () => {
  const ok = statusFromPayout({ id: "obp_1", status: "posted", receipt_url: "https://payments.stripe.com/r/1", trace_id: { value: "TRACE1" }, expected_arrival_date: "2026-09-19T00:00:00Z", from: { debited: { value: 9500, currency: "gbp" } } });
  assertEquals(ok.status, "posted");
  assertEquals(ok.trace_id, "TRACE1");
  assertEquals(ok.debited, { value: 9500, currency: "GBP" });
  const bad = statusFromPayout({ id: "obp_2", status: "returned", status_details: { returned: { reason: "account_closed" } } });
  assertEquals(bad.status, "returned");
  assertEquals(bad.detail, "account_closed");
  assertEquals(statusFromPayout({ status: "something_new" }).status, "processing");
});

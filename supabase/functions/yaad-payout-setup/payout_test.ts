// yaad-payout-setup: the parts that decide where a worker is sent and what
// Yaadly records about them. 20260914200000.
//
// Run: deno test --allow-read supabase/functions/

import { assert, assertEquals } from "jsr:@std/assert@1";
import { isStripeHostedUrl, recipientBody, recipientState } from "./payout.ts";

Deno.test("a worker is ready only when local bank payouts are active", () => {
  assertEquals(recipientState(null), "none");
  assertEquals(recipientState({}), "none");
  const acct = (status: string) => ({ id: "acct_1", configuration: { recipient: { capabilities: { bank_accounts: { local: { status } } } } } });
  assertEquals(recipientState(acct("active")), "ready");
  assertEquals(recipientState(acct("pending")), "needs_info");
  assertEquals(recipientState(acct("restricted")), "needs_info");
  assertEquals(recipientState({ id: "acct_1" }), "needs_info");
});

Deno.test("a worker is only ever sent to Stripe's own pages", () => {
  assert(isStripeHostedUrl("https://connect.stripe.com/setup/e/acct_1/abc"));
  assert(isStripeHostedUrl("https://stripe.com/x"));
  assert(!isStripeHostedUrl("http://connect.stripe.com/setup"), "plain http");
  assert(!isStripeHostedUrl("https://stripe.com.evil.example/x"), "lookalike host");
  assert(!isStripeHostedUrl("https://evilstripe.com/x"), "lookalike host");
  assert(!isStripeHostedUrl("not a url"));
});

Deno.test("the recipient is a person in Jamaica, paid to a local bank, and carries no bank detail", () => {
  const b = recipientBody("devon@example.com", "  Devon ");
  assertEquals(b.identity, { country: "jm", entity_type: "individual" });
  assertEquals(b.configuration.recipient.capabilities.bank_accounts.local.requested, true);
  assertEquals(b.display_name, "Devon");
  assertEquals(recipientBody("devon@example.com", "").display_name, "devon@example.com");
  assert(!/account_number|routing|branch|iban/i.test(JSON.stringify(b)), "Yaadly must not send bank details; the worker types them into Stripe");
});

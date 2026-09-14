// Tests for _shared/stripe.ts. No imports beyond the module under test, so a
// library version bump can never be the reason these go red.
import {
  checkStripeSignature,
  fromStripeAmount,
  hmacSha256Hex,
  isLiveKey,
  toStripeAmount,
} from "./stripe.ts";

function eq(actual: unknown, expected: unknown, msg = "") {
  if (actual !== expected) throw new Error(`${msg} expected ${String(expected)}, got ${String(actual)}`);
}
function throws(fn: () => unknown, msg: string) {
  try { fn(); } catch { return; }
  throw new Error(`expected a throw: ${msg}`);
}

Deno.test("J$ is stored in whole dollars and sent to Stripe in cents", () => {
  // INV-2026-0021, the invoice that exposed the J$ display bug on 14 Sep 2026.
  eq(toStripeAmount(134250, "JMD"), 13425000, "J$134,250");
  eq(toStripeAmount(11250, "jmd"), 1125000, "case insensitive");
});

Deno.test("pounds, dollars and Canadian dollars are already in minor units", () => {
  eq(toStripeAmount(14900, "GBP"), 14900, "£149.00");
  eq(toStripeAmount(14900, "USD"), 14900, "$149.00");
  eq(toStripeAmount(14900, "CAD"), 14900, "C$149.00");
});

Deno.test("the conversion round trips, so a recorded payment compares to the invoice", () => {
  eq(fromStripeAmount(toStripeAmount(134250, "JMD"), "JMD"), 134250, "JMD");
  eq(fromStripeAmount(toStripeAmount(14900, "GBP"), "GBP"), 14900, "GBP");
});

Deno.test("nothing is charged for a zero, negative, fractional or unknown amount", () => {
  throws(() => toStripeAmount(0, "JMD"), "zero");
  throws(() => toStripeAmount(-5, "GBP"), "negative");
  throws(() => toStripeAmount(10.5, "GBP"), "fraction");
  throws(() => toStripeAmount(100, "EUR"), "currency not set up");
  throws(() => toStripeAmount(100, ""), "no currency");
});

Deno.test("a live key is recognised, a test key is not", () => {
  eq(isLiveKey("sk_live_abc"), true, "secret live");
  eq(isLiveKey("rk_live_abc"), true, "restricted live");
  eq(isLiveKey("sk_test_abc"), false, "secret test");
  eq(isLiveKey(""), false, "empty");
});

const SECRET = "whsec_test_secret";
const BODY = '{"id":"evt_1","type":"checkout.session.completed"}';
const NOW = 1_789_000_000;

async function header(t: number, body = BODY, secret = SECRET) {
  return `t=${t},v1=${await hmacSha256Hex(secret, `${t}.${body}`)}`;
}

Deno.test("a correctly signed, fresh event passes", async () => {
  const r = await checkStripeSignature(BODY, await header(NOW), SECRET, NOW);
  eq(r.checked, true, "checked");
  eq(r.ok, true, "ok");
});

Deno.test("a changed body fails", async () => {
  const r = await checkStripeSignature(BODY + " ", await header(NOW), SECRET, NOW);
  eq(r.ok, false, "tampered body");
});

Deno.test("the wrong secret fails", async () => {
  const r = await checkStripeSignature(BODY, await header(NOW, BODY, "whsec_other"), SECRET, NOW);
  eq(r.ok, false, "wrong secret");
});

Deno.test("an old signature fails, so a captured event cannot be replayed later", async () => {
  const r = await checkStripeSignature(BODY, await header(NOW - 301), SECRET, NOW);
  eq(r.ok, false, "stale");
});

Deno.test("a missing or malformed header fails", async () => {
  eq((await checkStripeSignature(BODY, null, SECRET, NOW)).ok, false, "missing");
  eq((await checkStripeSignature(BODY, "nonsense", SECRET, NOW)).ok, false, "malformed");
});

Deno.test("no secret is reported as unchecked, never as a pass", async () => {
  const r = await checkStripeSignature(BODY, await header(NOW), "", NOW);
  eq(r.checked, false, "unchecked");
  eq(r.ok, false, "not ok");
});

/**
 * Tests for lib/jobs/billing.ts: in full or by stage.
 *
 * The line is a founder decision (13 Sep 2026): under J$ 100,000 client
 * total, always in full; at or above it, the quote says which. The database
 * enforces the same line (quote_billing_mode_allowed, 20260914090641), so a
 * change here that the database does not share would let the form offer a
 * choice the database then refuses.
 *
 * Run: npm test   (from web/)
 */
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(HERE, "ts-resolve-hooks.mjs")));

let b;
let c;
before(async () => {
  b = await import(pathToFileURL(join(HERE, "../lib/jobs/billing.ts")).href);
  c = await import(pathToFileURL(join(HERE, "../lib/jobs/client-bill.ts")).href);
});

describe("the J$ 100,000 line", () => {
  test("the threshold is J$ 100,000", () => {
    assert.equal(b.BILLING_THRESHOLD_JMD, 100000);
  });

  test("the verandah quote (J$ 134,250 all in) may be billed by stage", () => {
    const total = c.clientBill(75000, 48000).total;
    assert.equal(total, 134250);
    assert.equal(b.stageBillingAllowed(total), true);
    assert.deepEqual(b.resolveBillingMode(total, "by_stage"), { ok: true, mode: "by_stage" });
  });

  test("exactly J$ 100,000 is at the line, so stage billing is allowed", () => {
    assert.equal(b.stageBillingAllowed(100000), true);
  });

  test("J$ 99,999 is under the line: stage billing is refused with a reason", () => {
    const r = b.resolveBillingMode(99999, "by_stage");
    assert.equal(r.ok, false);
    assert.match(r.error, /pays in full/);
  });

  test("labour alone under the line but the total over it still counts the total", () => {
    const total = c.clientBill(60000, 35000).total; // 60,000 + 9,000 + 35,000
    assert.equal(total, 104000);
    assert.equal(b.stageBillingAllowed(total), true);
  });
});

describe("what gets saved", () => {
  test("nothing chosen is in full", () => {
    assert.deepEqual(b.resolveBillingMode(500000, null), { ok: true, mode: "in_full" });
  });

  test("an unknown value is in full, never stage billing", () => {
    assert.deepEqual(b.resolveBillingMode(500000, "weekly"), { ok: true, mode: "in_full" });
  });

  test("a stored null reads as in full", () => {
    assert.equal(b.billingModeOf(null), "in_full");
    assert.equal(b.billingModeOf("by_stage"), "by_stage");
  });
});

describe("the line the client reads", () => {
  test("each mode has its own sentence, with no dashes", () => {
    const DASHES = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");
    for (const m of ["in_full", "by_stage"]) {
      const line = b.billingLineForClient(m);
      assert.ok(line.length > 20);
      assert.equal(DASHES.test(line), false);
    }
    assert.notEqual(b.billingLineForClient("in_full"), b.billingLineForClient("by_stage"));
  });
});

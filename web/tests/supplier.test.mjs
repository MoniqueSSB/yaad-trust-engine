/**
 * Tests for lib/portal/supplier.ts, the supplier lane as the portal reads it.
 *
 * The failure that matters: a supplier being told payment is next before the
 * goods have been evidenced on site, or being shown "paid" on money that has
 * not gone. The step order is the product, so the order is what is proved.
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

let s;
before(async () => {
  s = await import(pathToFileURL(join(HERE, "../lib/portal/supplier.ts")).href);
});

const blank = () => ({
  released_at: "2026-10-15", confirmed_at: null, ready_at: null, collected_at: null,
  evidenced_at: null, sent_at: null, collector: "Devon", fulfilment: "collection",
});

describe("stepOf", () => {
  test("a fresh release is on the supplier's first step", () => {
    assert.equal(s.stepOf(blank()), 1);
    assert.equal(s.waitingOnSupplier(blank()), true);
  });
  test("steps are read in order, not by whichever stamp exists", () => {
    const o = { ...blank(), ready_at: "2026-10-16" }; // ready stamped, confirmed missing
    assert.equal(s.stepOf(o), 1, "an out-of-order stamp does not skip the supplier ahead");
  });
  test("payment is never 'next' before the site evidence", () => {
    const o = { ...blank(), confirmed_at: "a", ready_at: "b", collected_at: "c" };
    assert.equal(s.orderLabel(o).text, "Collected, waiting on Devon's site evidence");
    assert.equal(s.waitingOnSupplier(o), false);
    const e = { ...o, evidenced_at: "d" };
    assert.match(s.orderLabel(e).text, /payment is next/);
  });
  test("paid only when sent_at is set", () => {
    const o = { ...blank(), confirmed_at: "a", ready_at: "b", collected_at: "c", evidenced_at: "d" };
    assert.notEqual(s.orderLabel(o).text, "Paid");
    assert.equal(s.orderLabel({ ...o, sent_at: "e" }).text, "Paid");
  });
});

describe("statement", () => {
  test("owed is collected and unpaid; paid is sent; nothing is counted twice", () => {
    const rows = [
      { ...blank(), amount_jmd: 100, collected_at: "c", receipt_ref: "A" },
      { ...blank(), amount_jmd: 50, collected_at: "c", sent_at: "e", receipt_ref: "B" },
      { ...blank(), amount_jmd: 7, confirmed_at: "a" }, // not collected, not owed yet
    ];
    assert.deepEqual(s.statement(rows), { owed: 100, paid: 50, invoiced: 150 });
  });
  test("order total falls back to the release amount when no lines were typed", () => {
    assert.equal(s.orderTotal({ amount_jmd: 1234, lines: [] }), 1234);
    assert.equal(s.orderTotal({ amount_jmd: 1234, lines: [{ item: "x", qty: 2, unit_jmd: 10 }] }), 20);
  });
});

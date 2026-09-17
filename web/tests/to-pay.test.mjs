/**
 * Tests for lib/portal/to-pay.ts, the "To pay now" figure in the client
 * portal's right-hand panel.
 *
 * Why this file exists. This is a money figure shown to a client. The two
 * ways it can be wrong that matter: adding J$ to pounds (one meaningless
 * number), and asking a client to pay an invoice they have already paid by
 * card. If an assertion here ever has to be loosened to make a change pass,
 * the change is wrong. Fix the code, never the assertion.
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

let t;
before(async () => {
  t = await import(pathToFileURL(join(HERE, "../lib/portal/to-pay.ts")).href);
});

const inv = (over = {}) => ({
  id: "INV-1", status: "sent", total_pence: 100000, currency: "JMD",
  payable_to: "yaadly", client_email: "client@example.com", job_id: "JOB-1",
  service_id: null, ...over,
});
const ME = "Client@Example.com";

describe("toPay", () => {
  test("J$ and pounds are never added together", () => {
    const r = t.toPay([
      inv({ id: "A", currency: "JMD", total_pence: 134250 }),
      inv({ id: "B", currency: "GBP", total_pence: 14900, job_id: null, service_id: "S1" }),
    ], ME, new Set());
    assert.equal(r.totals.length, 2);
    assert.deepEqual(r.totals.find((x) => x.currency === "JMD").minor, 134250);
    assert.deepEqual(r.totals.find((x) => x.currency === "GBP").minor, 14900);
  });

  test("only sent invoices count", () => {
    const r = t.toPay([
      inv({ id: "A", status: "draft" }),
      inv({ id: "B", status: "paid" }),
      inv({ id: "C", status: "void" }),
      inv({ id: "D", status: "sent" }),
    ], ME, new Set());
    assert.deepEqual(r.unpaid.map((i) => i.id), ["D"]);
  });

  test("a worker's pay is never on the client's bill", () => {
    const r = t.toPay([inv({ payable_to: "worker" })], ME, new Set());
    assert.equal(r.unpaid.length, 0);
  });

  test("somebody else's invoice does not count, even if the query returned it", () => {
    const r = t.toPay([inv({ client_email: "someone.else@example.com" })], ME, new Set());
    assert.equal(r.unpaid.length, 0);
  });

  test("an invoice paid by card is not asked for again", () => {
    const r = t.toPay([inv({ id: "A" }), inv({ id: "B" })], ME, new Set(["A"]));
    assert.deepEqual(r.unpaid.map((i) => i.id), ["B"]);
    assert.equal(r.receivedCount, 1);
    assert.equal(r.totals[0].minor, 100000);
  });

  test("parts of a bill are summed like any invoice", () => {
    const r = t.toPay([
      inv({ id: "BILL", total_pence: 60000 }),
      inv({ id: "PART", total_pence: 40000 }),
    ], ME, new Set());
    assert.equal(r.totals[0].minor, 100000);
    assert.equal(r.totals[0].count, 2);
  });

  test("nothing to pay is an empty list, not a zero total", () => {
    const r = t.toPay([], ME, new Set());
    assert.equal(r.totals.length, 0);
  });
});

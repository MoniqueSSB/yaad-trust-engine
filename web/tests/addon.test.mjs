/**
 * Tests for lib/jobs/addon.ts: add-on work on a booked job.
 *
 * The figures must match the invoices the database drafts
 * (_draft_addon_client_invoice and sign_off_addon, 20260928235000):
 * the client pays the agreed amount plus 15%, the worker is paid the
 * amount less 5%, and "half now" is the larger half.
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

let a;
before(async () => {
  a = await import(pathToFileURL(join(HERE, "../lib/jobs/addon.ts")).href);
});

describe("what the client pays", () => {
  test("in full: the amount plus 15% on top", () => {
    const b = a.addonClientBill(26000, "in_full");
    assert.equal(b.total, 29900);
    assert.equal(b.fee, 3900);
    assert.equal(b.invoices.length, 1);
  });
  test("half now, half on sign-off: the first half is the larger", () => {
    const b = a.addonClientBill(15001, "half_now_half_on_signoff");
    assert.deepEqual(b.invoices.map((x) => x.work), [7501, 7500]);
    assert.equal(b.invoices[0].total, 7501 + Math.round(7501 * 0.15));
    assert.equal(b.invoices[1].total, 7500 + Math.round(7500 * 0.15));
  });
});

describe("what the worker is paid", () => {
  test("the amount less 5%", () => {
    assert.equal(a.addonWorkerPay(26000), 24700);
  });
});

describe("whose move it is", () => {
  test("with the worker waits on the worker", () => {
    assert.equal(a.waitingOn("with_worker"), "worker");
    assert.equal(a.waitingOn("with_client"), "client");
    assert.equal(a.waitingOn("agreed"), null);
  });
  test("the side it waits on is told it is their move", () => {
    assert.match(a.addonStateLine("with_worker", "worker", "the client"), /Waiting on you/);
    assert.equal(a.addonStateLine("with_worker", "client", "Marcus"), "Waiting on Marcus");
  });
  test("open and agreed add-ons hold the job; settled ones do not", () => {
    assert.equal(a.addonHoldsJob("with_client"), true);
    assert.equal(a.addonHoldsJob("agreed"), true);
    assert.equal(a.addonHoldsJob("signed_off"), false);
    assert.equal(a.addonHoldsJob("declined"), false);
    assert.equal(a.addonHoldsJob("cancelled"), false);
    assert.equal(a.addonStateLine("cancelled", "client", "x"), "Cancelled by Yaadly");
  });
});

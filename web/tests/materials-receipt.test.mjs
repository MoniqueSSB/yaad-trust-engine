/**
 * Tests for lib/portal/materials-receipt.ts, the materials receipt row in
 * the portal's outstanding list.
 *
 * Why this file exists. Two ways this goes wrong and both are about trust.
 * One, a row that keeps asking the worker for a receipt they have already
 * filed: they can see their own file on the page, so the room is telling
 * them something they know to be untrue. Two, a row that closes on a file
 * that is not the receipt for this money, which would quietly say the
 * materials are accounted for when nothing has been checked.
 *
 * Nothing here is a gate. "filed" is a file on a job; recording it against
 * the money is still a named person's decision at the desk. If an assertion
 * in this file has to be loosened to make a change pass, the change is
 * wrong. Fix the code, never the assertion.
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
  t = await import(pathToFileURL(join(HERE, "../lib/portal/materials-receipt.ts")).href);
});

const SENT = "2026-09-19T09:14:23.833Z";
const AFTER = "2026-09-19T13:32:00.832Z";
const BEFORE = "2026-09-12T10:00:00.000Z";

const release = (over = {}) => ({
  amount_jmd: 48000,
  released_at: "2026-09-14T15:18:15.790Z",
  sent_at: SENT,
  receipt_ref: "",
  ...over,
});

const file = (over = {}) => ({
  side: "worker",
  kind: "receipt",
  created_at: AFTER,
  ...over,
});

describe("materialsReceipt", () => {
  test("nothing released, nothing owed", () => {
    assert.deepEqual(t.materialsReceipt([], []), { state: "none" });
  });

  test("released but not yet sent is not a receipt due", () => {
    const r = t.materialsReceipt([release({ sent_at: null })], []);
    assert.equal(r.state, "none");
  });

  test("a recorded receipt_ref closes it, whatever is on Files", () => {
    const r = t.materialsReceipt([release({ receipt_ref: "HL-8842" })], [file()]);
    assert.equal(r.state, "none");
  });

  test("money sent, no receipt filed: due from the worker", () => {
    const r = t.materialsReceipt([release()], []);
    assert.deepEqual(r, { state: "due", jmd: 48000 });
  });

  test("the worker files a receipt after the money went out: filed", () => {
    const r = t.materialsReceipt([release()], [file()]);
    assert.equal(r.state, "filed");
    assert.equal(r.jmd, 48000);
    assert.equal(r.filedAt, AFTER);
  });

  test("a receipt filed before the money went out does not close it", () => {
    const r = t.materialsReceipt([release()], [file({ created_at: BEFORE })]);
    assert.equal(r.state, "due");
  });

  test("another kind of file does not close it", () => {
    const r = t.materialsReceipt([release()], [file({ kind: "quote" })]);
    assert.equal(r.state, "due");
  });

  test("the client's own receipt does not close the worker's row", () => {
    const r = t.materialsReceipt([release()], [file({ side: "client" })]);
    assert.equal(r.state, "due");
  });

  test("two unaccounted releases are one row, and the amounts add up", () => {
    const r = t.materialsReceipt(
      [release(), release({ amount_jmd: 12000, sent_at: AFTER })],
      [],
    );
    assert.deepEqual(r, { state: "due", jmd: 60000 });
  });

  test("an accounted release is left out of the amount", () => {
    const r = t.materialsReceipt(
      [release(), release({ amount_jmd: 12000, receipt_ref: "HL-8842" })],
      [],
    );
    assert.equal(r.jmd, 48000);
  });

  test("the earliest qualifying receipt is the one reported", () => {
    const later = "2026-09-20T08:00:00.000Z";
    const r = t.materialsReceipt(
      [release()],
      [file({ created_at: later }), file({ created_at: AFTER })],
    );
    assert.equal(r.filedAt, AFTER);
  });

  test("an unreadable created_at is not treated as a filed receipt", () => {
    const r = t.materialsReceipt([release()], [file({ created_at: "not a date" })]);
    assert.equal(r.state, "due");
  });
});

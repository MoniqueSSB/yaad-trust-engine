/**
 * Tests for lib/portal/board.ts, which puts a client's jobs into the three
 * columns of the stage board.
 *
 * Why this file exists. The one failure that matters here is a job vanishing
 * from a client's portal because its status is new or unusual. A client who
 * cannot see a disputed job assumes it has been dropped. So the test that an
 * unmapped status still lands in a column is the one to keep, whatever else
 * changes.
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
before(async () => {
  b = await import(pathToFileURL(join(HERE, "../lib/portal/board.ts")).href);
});

describe("groupForBoard", () => {
  test("every job lands in exactly one column", () => {
    const statuses = [
      "awaiting_client_setup", "draft", "open", "open_for_quotes", "quoted",
      "awaiting_payment", "confirmed", "in_progress", "evidence", "complete",
      "disputed", "cancelled", "something_new",
    ];
    const jobs = statuses.map((status, i) => ({ id: "JOB-" + i, status }));
    const g = b.groupForBoard(jobs);
    const total = g.quotes.length + g.under_way.length + g.closed.length;
    assert.equal(total, jobs.length);
  });

  test("an unmapped status still shows, in the middle column", () => {
    const g = b.groupForBoard([{ id: "J", status: "disputed" }]);
    assert.deepEqual(g.under_way.map((j) => j.id), ["J"]);
  });

  test("only complete is closed", () => {
    const g = b.groupForBoard([
      { id: "A", status: "complete" },
      { id: "B", status: "evidence" },
      { id: "C", status: "cancelled" },
    ]);
    assert.deepEqual(g.closed.map((j) => j.id), ["A"]);
  });

  test("paying the invoice is still before the job is booked", () => {
    assert.equal(b.clientColumnOf("awaiting_payment"), "quotes");
    assert.equal(b.clientColumnOf("confirmed"), "under_way");
  });

  test("order within a column is kept", () => {
    const g = b.groupForBoard([
      { id: "1", status: "open" },
      { id: "2", status: "quoted" },
      { id: "3", status: "draft" },
    ]);
    assert.deepEqual(g.quotes.map((j) => j.id), ["1", "2", "3"]);
  });
});

describe("clientStepOf", () => {
  test("the ladder runs 1 to CLIENT_STEPS", () => {
    assert.equal(b.clientStepOf("draft"), 1);
    assert.equal(b.clientStepOf("complete"), b.CLIENT_STEPS);
  });

  test("a status off the ladder has no step, not a guessed one", () => {
    assert.equal(b.clientStepOf("disputed"), null);
  });
});

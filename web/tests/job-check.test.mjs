/**
 * Tests for lib/portal/job-check.ts, the module that decides whether the
 * independent-check picker is still open on a job.
 *
 * The module mirrors two Postgres functions, choose_job_check() and
 * job_check_locked() (20260909180000). The database is the gate; these tests
 * hold the screen to the same reading so a client is never shown a choice the
 * database will refuse, or refused one it would allow. If one of these
 * assertions ever has to change to make a test pass, the screen and the
 * database have stopped agreeing. Fix the code, never the assertion.
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

let m;
before(async () => {
  m = await import(pathToFileURL(join(HERE, "../lib/portal/job-check.ts")).href);
});

const base = {
  workerEmail: "worker@example.com",
  status: "in_progress",
  checkLevel: null,
  finalStageCount: 2,
  evidenceStages: [],
};

describe("before scope is agreed", () => {
  test("no worker means no picker", () => {
    const r = m.jobCheckState({ ...base, workerEmail: null });
    assert.equal(r.state, "not_yet");
    assert.equal(r.canChange, false);
  });

  test("a check set by the desk still shows even without a worker", () => {
    const r = m.jobCheckState({ ...base, workerEmail: "", checkLevel: "visual" });
    assert.equal(r.state, "chosen");
    assert.equal(r.canChange, false);
  });
});

describe("while the choice is open", () => {
  test("worker on, nothing chosen, no evidence: open", () => {
    const r = m.jobCheckState(base);
    assert.equal(r.state, "open");
    assert.equal(r.canChange, true);
  });

  test("evidence on an EARLIER stage does not lock a two-stage job", () => {
    const r = m.jobCheckState({ ...base, evidenceStages: [1, 1] });
    assert.equal(r.state, "open");
    assert.equal(r.canChange, true);
  });

  test("a chosen check is still changeable before final evidence", () => {
    const r = m.jobCheckState({ ...base, checkLevel: "technical", evidenceStages: [1] });
    assert.equal(r.state, "chosen");
    assert.equal(r.canChange, true);
  });
});

describe("once final evidence is in, the portal locks", () => {
  test("evidence on the final stage locks an empty choice", () => {
    const r = m.jobCheckState({ ...base, evidenceStages: [1, 2] });
    assert.equal(r.state, "locked");
    assert.equal(r.canChange, false);
  });

  test("a null stage on an evidence item reads as stage 1, same as Postgres", () => {
    const r = m.jobCheckState({ ...base, finalStageCount: 1, evidenceStages: [null] });
    assert.equal(r.state, "locked");
  });

  test("a chosen check stays visible but cannot be changed", () => {
    const r = m.jobCheckState({ ...base, checkLevel: "visual", evidenceStages: [2] });
    assert.equal(r.state, "chosen");
    assert.equal(r.canChange, false);
  });

  test("a complete job is locked whatever the evidence says", () => {
    const r = m.jobCheckState({ ...base, status: "complete" });
    assert.equal(r.state, "locked");
    assert.equal(r.canChange, false);
  });

  test("a cancelled job is locked too", () => {
    assert.equal(m.jobCheckState({ ...base, status: "cancelled" }).state, "locked");
  });
});

describe("the small helpers agree with the database", () => {
  test("finalStageCountFrom never drops below one", () => {
    assert.equal(m.finalStageCountFrom(0), 1);
    assert.equal(m.finalStageCountFrom(3), 3);
  });

  test("only the two known levels are levels", () => {
    assert.equal(m.isCheckLevel("visual"), true);
    assert.equal(m.isCheckLevel("technical"), true);
    assert.equal(m.isCheckLevel("premium"), false);
    assert.equal(m.isCheckLevel(null), false);
  });

  test("only the Visual Check is offered; the Technical Sign-off is coming soon", () => {
    assert.equal(m.isCheckOffered("visual"), true);
    assert.equal(m.isCheckOffered("technical"), false);
    assert.deepEqual([...m.OFFERED_LEVELS], ["visual"]);
  });

  test("each level maps to its own returning-client catalogue row, not the standalone one", () => {
    assert.equal(m.CHECK_CATALOGUE_ID.visual, "job-visual-check");
    assert.equal(m.CHECK_CATALOGUE_ID.technical, "job-technical-check");
    assert.notEqual(m.CHECK_CATALOGUE_ID.visual, "eyes-on-it");
  });
});

describe("what the check adds to the job total", () => {
  const visual = { full_pence: 4500, founding_pence: 2500 };

  test("before an invoice, the founding rate is the figure", () => {
    assert.equal(m.checkChargePence(visual, null), 2500);
  });

  test("with no founding rate, the full price", () => {
    assert.equal(m.checkChargePence({ full_pence: 4500, founding_pence: null }, null), 4500);
  });

  test("once invoiced in pounds, the invoice is the figure", () => {
    const inv = { total_pence: 4500, currency: "GBP", status: "sent" };
    assert.equal(m.checkChargePence(visual, inv), 4500);
  });

  test("a void invoice falls back to the catalogue", () => {
    const inv = { total_pence: 4500, currency: "GBP", status: "void" };
    assert.equal(m.checkChargePence(visual, inv), 2500);
  });

  test("no catalogue row and no invoice means no figure, never a guess", () => {
    assert.equal(m.checkChargePence(null, null), null);
  });

  test("pence convert to whole J$ at the rate given", () => {
    assert.equal(m.penceToJmd(2500, 210), 5250);
    assert.equal(m.penceToJmd(4500, 210), 9450);
  });
});

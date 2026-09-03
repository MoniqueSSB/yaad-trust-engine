/**
 * Tests for lib/portal/gates.ts, the module that decides what a client still
 * has to do before a tradesperson can see their job.
 *
 * Why this file exists. Two screens render this list, the portal door and the
 * job room, and the module's own comment says a checklist that disagrees with
 * itself between pages is worse than no checklist because the reader cannot
 * tell which page is lying. Until now nothing held that promise except the
 * fact that both screens happened to call the same function. These tests hold
 * the promise instead.
 *
 * The gates mirror what Postgres enforces (client_go_live, then
 * enforce_signed_before_open, then enforce_store_before_open, then the
 * open_jobs predicate). If one of these assertions ever has to change to make
 * a test pass, the checklist and the database have stopped agreeing, and the
 * bug is that a client would be told "nothing outstanding" while the database
 * still refuses to open their job. Fix the code, never the assertion.
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

let g;
before(async () => {
  g = await import(pathToFileURL(join(HERE, "../lib/portal/gates.ts")).href);
});

/** A job as it exists the moment it is created: nothing done to it yet. */
const fresh = (over = {}) => ({ id: "JOB-TEST-1", open: false, stage: 0, worker_email: null, status: "draft", ...over });

const allClear = { emailConfirmed: true, signed: true, hasAcceptedMaterials: false };
const gatesFor = (job, over = {}) =>
  g.jobGates({ job, jobBase: "/portal/jobs/" + job.id, ...allClear, ...over });

describe("storeNamed", () => {
  test("a named store counts", () => {
    assert.equal(g.storeNamed(fresh({ materials_store_type: "lockable", materials_store: "Aunt's shed" })), true);
  });

  test("'none available' counts even with no store named, because it is an answer", () => {
    assert.equal(g.storeNamed(fresh({ materials_store_type: "none_available", materials_store: null })), true);
  });

  test("a type with a blank name is not an answer", () => {
    assert.equal(g.storeNamed(fresh({ materials_store_type: "lockable", materials_store: "   " })), false);
  });

  test("no type at all is not an answer", () => {
    assert.equal(g.storeNamed(fresh({ materials_store: "Aunt's shed" })), false);
  });
});

describe("onBoard mirrors the open_jobs predicate exactly", () => {
  test("open, no worker, stage 0 is on the board", () => {
    assert.equal(g.onBoard(fresh({ open: true })), true);
  });

  test("a worker on it means it is no longer on the board", () => {
    assert.equal(g.onBoard(fresh({ open: true, worker_email: "w@example.com" })), false);
  });

  test("past stage 0 means it is no longer on the board", () => {
    assert.equal(g.onBoard(fresh({ open: true, stage: 1 })), false);
  });

  test("not open means not on the board", () => {
    assert.equal(g.onBoard(fresh({ open: false })), false);
  });

  test("a null stage is treated as 0, not as missing", () => {
    assert.equal(g.onBoard(fresh({ open: true, stage: null })), true);
  });
});

describe("movedOn", () => {
  test("a chosen worker means the job has moved on", () => {
    assert.equal(g.movedOn(fresh({ worker_email: "w@example.com" })), true);
  });

  test("any stage past 0 means it has moved on", () => {
    assert.equal(g.movedOn(fresh({ stage: 1 })), true);
  });

  test("complete means it has moved on even at stage 0", () => {
    assert.equal(g.movedOn(fresh({ status: "complete" })), true);
  });

  test("a fresh draft has not moved on", () => {
    assert.equal(g.movedOn(fresh()), false);
  });
});

describe("stillWaiting decides whether the checklist speaks at all", () => {
  test("a fresh draft is still waiting", () => {
    assert.equal(g.stillWaiting(fresh()), true);
  });

  test("a job already on the board is not waiting", () => {
    assert.equal(g.stillWaiting(fresh({ open: true })), false);
  });

  test("a job with a worker is not waiting", () => {
    assert.equal(g.stillWaiting(fresh({ worker_email: "w@example.com" })), false);
  });

  test("a completed job is not waiting, so the list retires rather than nagging", () => {
    assert.equal(g.stillWaiting(fresh({ status: "complete", stage: 11 })), false);
  });

  test("on the board and moved on are mutually exclusive for every shape here", () => {
    for (const job of [fresh(), fresh({ open: true }), fresh({ stage: 3 }), fresh({ worker_email: "w@e.com" })]) {
      assert.equal(g.onBoard(job) && g.movedOn(job), false, JSON.stringify(job));
    }
  });
});

describe("jobGates", () => {
  test("a client who has done nothing sees both account gates, not done", () => {
    const gates = gatesFor(fresh(), { emailConfirmed: false, signed: false });
    assert.equal(gates.length, 2);
    assert.deepEqual(gates.map((x) => x.scope), ["account", "account"]);
    assert.deepEqual(gates.map((x) => x.done), [false, false]);
  });

  test("the order matches the order Postgres applies them, email before signature", () => {
    const [first, second] = gatesFor(fresh(), { emailConfirmed: false, signed: false });
    assert.match(first.title, /Confirm your email/i);
    assert.match(second.title, /Sign the Client Guidelines/i);
  });

  test("the signature gate names the exact version in force", () => {
    const [, signature] = gatesFor(fresh(), { signed: false });
    assert.ok(
      signature.title.includes(g.CG_VERSION),
      `signature gate must name CG_VERSION ${g.CG_VERSION}, got: ${signature.title}`,
    );
  });

  test("the email gate has no link, because it clears itself from the inbox", () => {
    const [email] = gatesFor(fresh(), { emailConfirmed: false });
    assert.equal(email.href, undefined);
  });

  test("the signature gate links to the page that clears it", () => {
    const [, signature] = gatesFor(fresh(), { signed: false });
    assert.equal(signature.href, "/portal/guidelines");
    assert.ok(signature.cta, "a gate with a link needs words on the button");
  });

  test("no accepted materials means the materials question is not asked at all", () => {
    const gates = gatesFor(fresh());
    assert.equal(gates.some((x) => /materials/i.test(x.title)), false);
  });

  test("accepted materials adds one job scoped gate", () => {
    const gates = gatesFor(fresh(), { hasAcceptedMaterials: true });
    const materials = gates.find((x) => /materials/i.test(x.title));
    assert.ok(materials, "materials gate should be present");
    assert.equal(materials.scope, "job");
  });

  test("the materials gate is done once a store is named", () => {
    const job = fresh({ materials_store_type: "lockable", materials_store: "Aunt's shed" });
    const materials = gatesFor(job, { hasAcceptedMaterials: true }).find((x) => /materials/i.test(x.title));
    assert.equal(materials.done, true);
  });

  test("the materials gate anchors into the job it belongs to", () => {
    const materials = gatesFor(fresh(), { hasAcceptedMaterials: true }).find((x) => /materials/i.test(x.title));
    assert.equal(materials.href, "/portal/jobs/JOB-TEST-1?tab=materials#materials");
  });

  test("account gates are identical across two different jobs, so they can be shown once", () => {
    const a = gatesFor(fresh({ id: "JOB-A" }), { emailConfirmed: false, signed: false });
    const b = gatesFor(fresh({ id: "JOB-B" }), { emailConfirmed: false, signed: false });
    const strip = (gs) => gs.filter((x) => x.scope === "account").map(({ title, why, done, href }) => ({ title, why, done, href }));
    assert.deepEqual(strip(a), strip(b));
  });

  test("every gate explains itself in the client's terms, never as a schema name", () => {
    for (const gate of gatesFor(fresh(), { emailConfirmed: false, signed: false, hasAcceptedMaterials: true })) {
      assert.ok(gate.why && gate.why.length > 20, `gate "${gate.title}" needs a real reason`);
      assert.doesNotMatch(
        gate.why + gate.title,
        /client_profiles|doc_signatures|enforce_|auth\.users|open_jobs/,
        `gate "${gate.title}" leaks a schema name to the client`,
      );
    }
  });

  test("a gate with a link always has a call to action, so no button is unlabelled", () => {
    for (const gate of gatesFor(fresh(), { emailConfirmed: false, signed: false, hasAcceptedMaterials: true })) {
      if (gate.href) assert.ok(gate.cta, `gate "${gate.title}" has a link and no words on it`);
    }
  });
});

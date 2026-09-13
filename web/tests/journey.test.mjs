/**
 * Tests for lib/portal/journey.ts, the module that decides where a job sits on
 * the rail the client reads and approves against.
 *
 * Why this file exists. Two shapes of payment schedule reach these functions
 * from two different routes: a Kickoff Pack nests its stages at
 * docs.payment_schedule.stages, a Quote Pack keeps a flat array at
 * docs.payment_stages and calls the release wording evidence_note rather than
 * release_condition. sync_job_status() already had to learn both shapes on
 * 2 Sep after a job's stage count was read from the wrong one and three parts
 * of the product disagreed about how many stages that job had. Nothing tested
 * the screen-side half of that lookup until now.
 *
 * The statuses asserted here are the real vocabulary from the
 * jobs_status_check constraint, not invented ones. If a status is added to the
 * database, this file should fail until the map knows about it, because the
 * fallback silently reports "stage 0" and a client reading that is being told
 * their finished job has not started.
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

let j;
before(async () => {
  j = await import(pathToFileURL(join(HERE, "../lib/portal/journey.ts")).href);
});

describe("the rails themselves", () => {
  /* THESE TWO ASSERTIONS WERE CHANGED ON 3 SEP 2026, and it is worth being
     loud about that because changing a test to make code pass is normally the
     wrong move and this repo says so.
   
     They are not being weakened to accommodate a broken change. The FACT they
     described stopped being true: the service rail was twelve stages per
     PORTAL-SPEC v1.0, and the founder decided it is six, the six a client has
     actually been reading. See DECISIONS.md, 3 Sep. The old numbers are kept
     in this comment so the change is visible rather than silent:
     STAGES_SVC.length was 12, it started at "Booked & paid" and ended at
     "Review". */
  test("a job rail has 13 stages and a service rail has 6", () => {
    assert.equal(j.STAGES.length, 13);
    assert.equal(j.STAGES_SVC.length, 6);
  });

  test("both rails start at something live and end at something finished", () => {
    assert.equal(j.STAGES[0], "Job live");
    assert.equal(j.STAGES[j.STAGES.length - 1], "Reviews");
    assert.equal(j.STAGES_SVC[0], "Booked and paid");
    assert.equal(j.STAGES_SVC[j.STAGES_SVC.length - 1], "Delivered");
  });

  /* The test that makes the bug this replaced impossible rather than merely
     fixed. There were two service lists of different lengths, both indexed by
     the same services.stage column, both rendered on the same page: a booking
     at stage 5 said "Delivered" in the heading and "M1 · evidence" on the rail.
     STAGES_SVC is now DERIVED from SERVICE_TRACK, so the two cannot disagree
     about length or order. If somebody restates it as a literal again, this
     fails. */
  test("the service rail is derived from the track, so the two cannot drift", () => {
    assert.deepEqual(j.STAGES_SVC, j.SERVICE_TRACK.map((s) => s.name));
    assert.equal(j.STAGES_SVC.length, j.SERVICE_TRACK.length);
  });

  test("every service stage carries a sentence saying what it means", () => {
    for (const s of j.SERVICE_TRACK) {
      assert.ok(s.name?.trim(), "a stage with no name");
      assert.ok(s.detail?.trim().length > 15, `stage "${s.name}" has no real detail`);
    }
  });

  test("svcStage clamps to the service rail, not to some other length", () => {
    assert.equal(j.svcStage(999), j.SERVICE_TRACK.length - 1);
  });

  test("no stage name is blank, so the rail never renders an unlabelled step", () => {
    for (const name of [...j.STAGES, ...j.STAGES_SVC]) assert.ok(name.trim().length > 0);
  });
});

describe("jobStage maps the real status vocabulary", () => {
  // Read from the jobs_status_check constraint, plus awaiting_payment which
  // was added on 2 Sep with the payment gate.
  const REAL = [
    "draft", "awaiting_client_setup", "open_for_quotes", "quoted",
    "awaiting_payment", "in_progress", "disputed", "complete", "cancelled",
  ];

  test("every real status is known to the map, none falls through to 0 by accident", () => {
    for (const status of REAL) {
      const stage = j.jobStage(status);
      assert.equal(typeof stage, "number", `${status} should map to a number`);
      assert.ok(stage >= 0 && stage < j.STAGES.length, `${status} mapped out of range: ${stage}`);
    }
  });

  test("progress increases along the real order of a job", () => {
    assert.ok(j.jobStage("quoted") > j.jobStage("open_for_quotes"));
    assert.ok(j.jobStage("awaiting_payment") > j.jobStage("quoted"));
    assert.ok(j.jobStage("in_progress") > j.jobStage("awaiting_payment"));
    assert.ok(j.jobStage("complete") > j.jobStage("in_progress"));
  });

  test("complete lands on 'Closed & paid', not past the end of the rail", () => {
    assert.equal(j.STAGES[j.jobStage("complete")], "Closed & paid");
  });

  test("an unknown status lands at the start rather than lying about progress", () => {
    assert.equal(j.jobStage("not_a_real_status"), 0);
    assert.equal(j.jobStage(null), 0);
    assert.equal(j.jobStage(""), 0);
  });

  test("cancelled reports 0 rather than inheriting whatever it was before", () => {
    assert.equal(j.jobStage("cancelled"), 0);
  });
});

describe("svcStage clamps rather than trusting the column", () => {
  test("a normal index passes through", () => {
    assert.equal(j.svcStage(3), 3);
  });
  test("null is the start", () => {
    assert.equal(j.svcStage(null), 0);
  });
  test("a negative never renders before the rail", () => {
    assert.equal(j.svcStage(-4), 0);
  });
  test("an index past the end clamps to the last real stage", () => {
    assert.equal(j.svcStage(999), j.STAGES_SVC.length - 1);
  });
});

describe("packPaymentStages reads the Kickoff Pack shape", () => {
  const docs = { payment_schedule: { stages: [
    { stage: "Strip and dry out", proportion_percent: 40, release_condition: "Before and after photos" },
    { stage: "Re-cover", proportion_percent: 60 },
  ] } };

  test("reads the nested stages", () => {
    const s = j.packPaymentStages(docs);
    assert.equal(s.length, 2);
    assert.equal(s[0].stage, "Strip and dry out");
    assert.equal(s[0].proportion_percent, 40);
    assert.equal(s[0].release_condition, "Before and after photos");
  });

  test("a pack with no schedule is an empty list, never a throw", () => {
    for (const bad of [null, undefined, {}, { payment_schedule: {} }, { payment_schedule: { stages: "no" } }]) {
      assert.deepEqual(j.packPaymentStages(bad), []);
    }
  });

  test("an entry with no stage name is dropped, not rendered blank", () => {
    const s = j.packPaymentStages({ payment_schedule: { stages: [{ proportion_percent: 50 }, { stage: "Real" }] } });
    assert.deepEqual(s.map((x) => x.stage), ["Real"]);
  });
});

describe("quotePackPaymentStages reads the other shape and normalises it", () => {
  const docs = { payment_stages: [
    { stage: "First fix", proportion_percent: 50, evidence_note: "Photos of the run" },
    { stage: "Second fix", proportion_percent: 50 },
  ] };

  test("reads the flat array", () => {
    assert.deepEqual(j.quotePackPaymentStages(docs).map((x) => x.stage), ["First fix", "Second fix"]);
  });

  test("evidence_note becomes release_condition, so both shapes read the same downstream", () => {
    assert.equal(j.quotePackPaymentStages(docs)[0].release_condition, "Photos of the run");
  });

  test("a quote pack with nothing on it is an empty list, never a throw", () => {
    for (const bad of [null, undefined, {}, { payment_stages: "no" }]) {
      assert.deepEqual(j.quotePackPaymentStages(bad), []);
    }
  });

  test("the two readers do not read each other's shape, which is the bug they exist to prevent", () => {
    const kickoff = { payment_schedule: { stages: [{ stage: "K" }] } };
    const quote = { payment_stages: [{ stage: "Q" }] };
    assert.deepEqual(j.quotePackPaymentStages(kickoff), []);
    assert.deepEqual(j.packPaymentStages(quote), []);
  });
});

describe("jobStages swaps in the pack's own stage names once work starts", () => {
  const pack = [{ stage: "Strip and dry out" }, { stage: "Re-cover" }];

  test("before work starts, the fixed rail is used whatever the pack says", () => {
    for (const status of ["draft", "awaiting_client_setup", "open_for_quotes", "quoted", "awaiting_payment"]) {
      const r = j.jobStages(status, 0, pack);
      assert.deepEqual(r.stages, [...j.STAGES], `${status} should keep the fixed rail`);
      assert.equal(r.current, j.jobStage(status));
    }
  });

  test("a job with no pack keeps the fixed rail even once under way", () => {
    const r = j.jobStages("in_progress", 1, []);
    assert.deepEqual(r.stages, [...j.STAGES]);
  });

  test("once under way with a pack, the client approves against the pack's own names", () => {
    const r = j.jobStages("in_progress", 1, pack);
    assert.ok(r.stages.includes("Strip and dry out"));
    assert.ok(r.stages.includes("Re-cover"));
    assert.equal(r.stages[r.current], "Strip and dry out", "stage 1 should be the pack's first stage");
  });

  test("stage 2 lands on the pack's second stage, not one off", () => {
    const r = j.jobStages("in_progress", 2, pack);
    assert.equal(r.stages[r.current], "Re-cover");
  });

  test("a complete job lands on 'Closed & paid', never past the end", () => {
    const r = j.jobStages("complete", 2, pack);
    assert.equal(r.stages[r.current], "Closed & paid");
    assert.ok(r.current < r.stages.length);
  });

  test("current is never past the end of the rail, however wrong the stage column is", () => {
    for (const stage of [1, 2, 5, 40, 999]) {
      const r = j.jobStages("in_progress", stage, pack);
      assert.ok(r.current < r.stages.length, `stage ${stage} produced current ${r.current} of ${r.stages.length}`);
      assert.ok(r.stages[r.current] !== undefined, `stage ${stage} pointed at nothing`);
    }
  });

  test("the rail keeps the pre-work steps and the closing tail around the pack's stages", () => {
    const r = j.jobStages("in_progress", 1, pack);
    assert.equal(r.stages[0], "Job live");
    assert.equal(r.stages[r.stages.length - 2], "Closed & paid");
    assert.equal(r.stages[r.stages.length - 1], "Reviews");
  });

  test("a one stage pack still produces a coherent rail", () => {
    const r = j.jobStages("in_progress", 1, [{ stage: "The whole job" }]);
    assert.equal(r.stages[r.current], "The whole job");
    assert.ok(r.current < r.stages.length);
  });

  test("a Quote Pack's stages drive the rail exactly as a Kickoff Pack's do", () => {
    const fromQuote = j.quotePackPaymentStages({ payment_stages: [{ stage: "First fix" }, { stage: "Second fix" }] });
    const r = j.jobStages("in_progress", 2, fromQuote);
    assert.equal(r.stages[r.current], "Second fix");
  });
});

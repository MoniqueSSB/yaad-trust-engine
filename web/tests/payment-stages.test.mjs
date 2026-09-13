/**
 * Tests for lib/jobs/payment-stages.ts, the reader that decides whether a
 * quote's payment stages can become the job's stage schedule.
 *
 * Why this file exists. Since 13 Sep 2026 the accepted quote's stages ARE the
 * schedule: how many stages the job has, and what the worker is owed as each
 * is approved. A stage line read wrongly is a worker paid wrongly. The same
 * rule lives in Postgres as parse_payment_stages() (20260913222130); the
 * verandah case below is the real quote that exposed the gap, and the SQL
 * guard test supabase/tests/stage_schedule_guards.sql asserts the same three
 * stages from the database side.
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

let p;
before(async () => {
  p = await import(pathToFileURL(join(HERE, "../lib/jobs/payment-stages.ts")).href);
});

const VERANDAH =
  "Materials on site: 30%: photo of the treated timber, fixings and paint delivered to the property\r\n" +
  "Posts and rails fitted: 40%: photos of the new posts standing plumb and a video of the rail being pushed and not moving\r\n" +
  "Painted and cleared: 30%: photos of the finished painted rails and posts from the same angles as the before photos, and the area swept clear";

describe("stages that read", () => {
  test("the verandah quote reads as three stages, 30, 40 and 30", () => {
    const r = p.parsePaymentStages(VERANDAH);
    assert.equal(r.ok, true);
    assert.deepEqual(r.stages.map((s) => s.stage), ["Materials on site", "Posts and rails fitted", "Painted and cleared"]);
    assert.deepEqual(r.stages.map((s) => s.proportion_percent), [30, 40, 30]);
    assert.match(r.stages[1].evidence_note, /^photos of the new posts/);
  });

  test("blank lines and stray spaces are ignored", () => {
    const r = p.parsePaymentStages("\n  Start : 50 % : photos \n\n Finish:50%:  site clear  \n");
    assert.equal(r.ok, true);
    assert.deepEqual(r.stages, [
      { stage: "Start", proportion_percent: 50, evidence_note: "photos" },
      { stage: "Finish", proportion_percent: 50, evidence_note: "site clear" },
    ]);
  });

  test("the proof may contain a colon", () => {
    const r = p.parsePaymentStages("Whole job: 100%: photos: before and after");
    assert.equal(r.ok, true);
    assert.equal(r.stages[0].evidence_note, "photos: before and after");
  });

  test("decimals that total the whole are fine", () => {
    const r = p.parsePaymentStages("A: 33.33%: x\nB: 33.33%: y\nC: 33.34%: z");
    assert.equal(r.ok, true);
  });
});

describe("stages that are refused, with the reason a worker can act on", () => {
  test("nothing written", () => {
    const r = p.parsePaymentStages("   ");
    assert.equal(r.ok, false);
    assert.match(r.error, /Add your payment stages/);
  });

  test("a line without the shape names the line", () => {
    const r = p.parsePaymentStages("Start: 50%: photos\nthe rest when done");
    assert.equal(r.ok, false);
    assert.match(r.error, /line 2/);
  });

  test("a percentage with no proof after it", () => {
    assert.equal(p.parsePaymentStages("Whole job: 100%").ok, false);
  });

  test("amounts instead of percentages", () => {
    assert.equal(p.parsePaymentStages("Start: J$20000: photos").ok, false);
  });

  test("stages that do not add up to the whole", () => {
    const r = p.parsePaymentStages("Start: 30%: photos\nFinish: 60%: site clear");
    assert.equal(r.ok, false);
    assert.match(r.error, /add up to 90/);
  });

  test("a zero stage", () => {
    assert.equal(p.parsePaymentStages("Start: 0%: photos\nFinish: 100%: done").ok, false);
  });

  test("more than ten stages", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `S${i}: ${i === 0 ? 0.1 * 1 : 9.99}%: x`).join("\n");
    const r = p.parsePaymentStages(eleven);
    assert.equal(r.ok, false);
    assert.match(r.error, /ten/);
  });

  test("the refusal copy uses no dashes", () => {
    /* Built from the code points, so this file itself carries no dash. */
    const DASHES = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");
    const r = p.parsePaymentStages("nope");
    assert.equal(DASHES.test(r.error), false);
  });
});

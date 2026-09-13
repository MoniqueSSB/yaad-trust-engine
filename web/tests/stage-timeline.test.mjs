/**
 * Tests for lib/portal/stage-timeline.ts, the dated stage history the
 * calendar draws.
 *
 * The one that matters most is the Jamaica day. A record made late in the
 * evening in London must land on the day it was in Portmore, the same day
 * the arrival log already uses, or the calendar and the log disagree about
 * when something happened.
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
  t = await import(pathToFileURL(join(HERE, "../lib/portal/stage-timeline.ts")).href);
});

describe("Jamaica day and time", () => {
  test("a timestamp after 7pm Jamaica is still that Jamaica day, not the UTC next day", () => {
    // 02:30 UTC on the 6th is 21:30 on the 5th in Kingston.
    assert.equal(t.jamaicaDay("2026-09-06T02:30:00Z"), "2026-09-05");
    assert.equal(t.jamaicaTime("2026-09-06T02:30:00Z"), "9:30 pm");
  });

  test("midday and midnight read as 12, not 0", () => {
    assert.equal(t.jamaicaTime("2026-09-05T17:00:00Z"), "12:00 pm");
    assert.equal(t.jamaicaTime("2026-09-05T05:04:00Z"), "12:04 am");
  });

  test("nonsense in, null out", () => {
    assert.equal(t.jamaicaDay(null), null);
    assert.equal(t.jamaicaDay("not a date"), null);
  });

  test("shortDay reads like the rest of the portal", () => {
    assert.equal(t.shortDay("2026-09-03"), "3 Sep 2026");
  });
});

describe("buildStageEvents", () => {
  test("evidence filed on one stage in one evening is one line with a count", () => {
    const ev = t.buildStageEvents({
      evidence: [
        { stage: 2, created_at: "2026-09-05T23:10:00Z" },
        { stage: 2, created_at: "2026-09-05T22:40:00Z" },
        { stage: 2, created_at: "2026-09-05T23:55:00Z" },
        { stage: 3, created_at: "2026-09-05T23:00:00Z" },
      ],
    });
    const s2 = ev.filter((e) => e.stage === 2);
    assert.equal(s2.length, 1);
    assert.equal(s2[0].count, 3);
    assert.equal(s2[0].time, "5:40 pm", "the line carries the first item's time");
    assert.equal(ev.filter((e) => e.stage === 3).length, 1);
  });

  test("arrival uses arrived_on as recorded, and one check-in per stage per day", () => {
    const ev = t.buildStageEvents({
      arrivals: [
        { stage: 1, arrived_at: "2026-09-03T13:14:00Z", arrived_on: "2026-09-03" },
        { stage: 1, arrived_at: "2026-09-03T18:00:00Z", arrived_on: "2026-09-03" },
      ],
    });
    assert.equal(ev.length, 1);
    assert.equal(ev[0].day, "2026-09-03");
    assert.equal(ev[0].time, "8:14 am");
  });

  test("a void invoice and a stage-less invoice are not a stage paid", () => {
    const ev = t.buildStageEvents({
      paidInvoices: [
        { stage: 1, paid_at: "2026-09-08T15:00:00Z", status: "void" },
        { stage: null, paid_at: "2026-09-08T15:00:00Z", status: "paid" },
        { stage: 1, paid_at: "2026-09-09T15:00:00Z", status: "paid" },
      ],
    });
    assert.equal(ev.length, 1);
    assert.equal(ev[0].day, "2026-09-09");
  });

  test("events come back in the order they happened", () => {
    const ev = t.buildStageEvents({
      approvals: [{ stage: 1, approved_at: "2026-09-06T12:00:00Z" }],
      agreedAt: "2026-09-01T12:00:00Z",
      materials: [{ stage: 1, released_at: "2026-09-02T12:00:00Z" }],
    });
    assert.deepEqual(ev.map((e) => e.kind), ["agreed", "materials", "approved"]);
  });
});

describe("labels", () => {
  test("each side reads the event from where they stand", () => {
    const arrived = { day: "2026-09-03", time: null, at: "x", kind: "arrived", stage: 2 };
    assert.equal(t.eventLabel(arrived, "worker"), "Stage 2 · you arrived on site");
    assert.equal(t.eventLabel(arrived, "client"), "Stage 2 · worker arrived on site");
    const paid = { ...arrived, kind: "paid" };
    assert.equal(t.eventLabel(paid, "worker"), "Stage 2 · your pay invoice paid");
    assert.equal(t.eventLabel(paid, "client"), "Stage 2 · invoice paid");
  });

  test("no label says escrow or says money is held", () => {
    const kinds = ["agreed", "arrived", "evidence", "approved", "paid", "materials"];
    for (const kind of kinds) {
      for (const side of ["client", "worker"]) {
        const label = t.eventLabel({ day: "2026-09-03", time: null, at: "x", kind, stage: 1 }, side);
        assert.doesNotMatch(label, /escrow|held|\u2014|\u2013/i);
      }
    }
  });
});

describe("stageHistory", () => {
  test("lists every stage in the pack, even ones with nothing yet", () => {
    const rows = t.stageHistory([], ["Site prep", "Walls", "Finish"]);
    assert.deepEqual(rows.map((r) => [r.stage, r.name]), [[1, "Site prep"], [2, "Walls"], [3, "Finish"]]);
  });

  test("keeps the first of each kind, and a stage outside the pack still shows", () => {
    const ev = t.buildStageEvents({
      arrivals: [
        { stage: 1, arrived_at: "2026-09-04T13:00:00Z", arrived_on: "2026-09-04" },
        { stage: 1, arrived_at: "2026-09-03T13:00:00Z", arrived_on: "2026-09-03" },
      ],
      approvals: [{ stage: 4, approved_at: "2026-09-10T13:00:00Z" }],
    });
    const rows = t.stageHistory(ev, ["Site prep"]);
    assert.equal(rows[0].firsts.arrived.day, "2026-09-03");
    assert.equal(rows.at(-1).stage, 4);
    assert.equal(rows.at(-1).name, null);
  });
});

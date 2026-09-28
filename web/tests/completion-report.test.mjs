/**
 * Tests for lib/portal/completion-report.ts, the rules behind the summary at
 * the top of the Completion Report.
 *
 * The outcome line is the sentence an owner overseas reads first and forwards.
 * It must never read better than the record: a new find nobody dealt with, an
 * arrival away from the site and a dispute all have to show up in it. If one
 * of those assertions ever has to be loosened to make a change pass, the
 * change is hiding something from the owner. Fix the code, never the
 * assertion.
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

let c;
before(async () => {
  c = await import(pathToFileURL(join(HERE, "../lib/portal/completion-report.ts")).href);
});

const base = { stagesApproved: 2, methods: [null, null], problems: 0, newFinds: 0, farArrivals: 0, disputes: 0 };

describe("the outcome line", () => {
  test("a clean job says so, and nothing more", () => {
    assert.equal(c.outcomeLine(base), "Complete. Both stages approved by the owner, on the evidence. No disputes raised.");
  });

  test("a new find is never left out", () => {
    assert.match(c.outcomeLine({ ...base, newFinds: 1 }), /One new find recorded outside the job, not part of this work\./);
  });

  test("an arrival away from the site is said, not hidden", () => {
    assert.match(c.outcomeLine({ ...base, farArrivals: 2 }), /Two arrivals logged away from the site\./);
  });

  test("a dispute is counted", () => {
    assert.match(c.outcomeLine({ ...base, disputes: 1 }), /One dispute raised\./);
    assert.doesNotMatch(c.outcomeLine({ ...base, disputes: 1 }), /No disputes/);
  });

  test("how it was approved is only claimed when every stage agrees", () => {
    assert.match(c.outcomeLine({ ...base, methods: ["in_person", "in_person"] }), /approved by the owner, in person\./);
    assert.match(c.outcomeLine({ ...base, methods: ["in_person", null] }), /approved by the owner\./);
  });

  test("three or more stages read as all", () => {
    assert.match(c.outcomeLine({ ...base, stagesApproved: 4, methods: [null, null, null, null] }), /^Complete\. All 4 stages/);
  });

  test("never an overclaim word", () => {
    const s = c.outcomeLine({ ...base, problems: 3, newFinds: 2, farArrivals: 1, disputes: 1 });
    assert.doesNotMatch(s, /100%|guarantee|certif|escrow|fully covered/i);
  });
});

describe("aftercare end date", () => {
  test("twelve months on, on the Jamaica day", () => {
    // 02:00 UTC on 24 Sep is still 23 Sep in Kingston.
    assert.equal(c.aftercareEnds("2026-09-24T02:00:00Z"), "2027-09-23");
  });
  test("29 February becomes 28 February, never March", () => {
    assert.equal(c.aftercareEnds("2028-02-29T15:00:00Z"), "2029-02-28");
  });
  test("nothing in, nothing out", () => {
    assert.equal(c.aftercareEnds(null), null);
    assert.equal(c.aftercareEnds("not a date"), null);
  });
});

describe("the rest", () => {
  test("phase counts follow the order of the work", () => {
    const items = [
      { phase: "after" }, { phase: "before" }, { phase: "before" }, { phase: "issue" },
      { kind: "materials" }, { phase: null },
    ];
    assert.equal(c.phaseCounts(items), "2 before, 1 problem, 1 after, 1 materials receipt, 1 not marked");
  });

  test("care notes typed one per line come back as a list", () => {
    assert.deepEqual(c.notesFromText("- Keep it dry\n\n  • Wipe  down after use \n"), ["Keep it dry", "Wipe down after use"]);
  });

  test("a draft is always the agent's, never a person's", () => {
    assert.equal(c.trailWho({ step: "drafted", actor_name: "Somebody", actor_email: "x@y", at: "", detail: {} }), "Drafting agent");
  });

  test("a signature with changes says so", () => {
    assert.match(c.trailLabel({ step: "signed", actor_name: "A B", actor_email: null, at: "", detail: { changed: true } }), /with changes/);
  });

  test("dates print as a person reads them, Jamaica time", () => {
    assert.equal(c.fmtWhen("2026-09-15T13:12:00Z"), "15 Sep 2026, 08:12");
  });
});

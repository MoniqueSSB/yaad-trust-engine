/**
 * Tests for lib/portal/properties.ts, which groups a client's jobs into the
 * properties they own.
 *
 * Why this file exists. The grouping decides what a business client sees when
 * they open their portfolio, and two of its choices are deliberate rather than
 * convenient, so they need holding in place.
 *
 * ONE: it does not fuzzy match addresses. "12 Barbican Rd." and "12 Barbican
 * Road" stay apart. Guessing they are the same place is how a job shows up
 * under the wrong property, and the fix for a near miss is a person correcting
 * the address, not a similarity score nobody can audit.
 *
 * TWO: jobs with no address group per PARISH, not into one pile. On
 * 4 September 2026 only 5 of 40 jobs had an address, so the unidentified
 * bucket is the common case, and one pile would tell a client with a house in
 * Portmore and a shop in St Ann that they are the same building.
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
  p = await import(pathToFileURL(join(HERE, "../lib/portal/properties.ts")).href);
});

const job = (over = {}) => ({
  id: "JOB-1", title: "A job", trade: "Plumbing", parish: "Kingston",
  addr: null, stage: 0, status: "open_for_quotes", open: true,
  updated_at: "2026-09-01T10:00:00Z", ...over,
});

describe("addressKey", () => {
  test("normalises case, punctuation and spacing", () => {
    assert.equal(p.addressKey("  12  Barbican   Road, Kingston 8 "), "12 barbican road kingston 8");
  });
  test("an empty or missing address is an empty key, never a match", () => {
    assert.equal(p.addressKey(null), "");
    assert.equal(p.addressKey("   "), "");
  });
});

describe("grouping", () => {
  test("two jobs at the same address are one property", () => {
    const out = p.groupIntoProperties([
      job({ id: "A", addr: "12 Barbican Road" }),
      job({ id: "B", addr: "12 barbican  road" }),
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].jobs.length, 2);
    assert.equal(out[0].unidentified, false);
  });

  test("Rd. and Road are NOT guessed to be the same place", () => {
    // Deliberate. A wrong merge puts a job under a property the client does
    // not own; a wrong split is a visible duplicate they can fix by editing
    // an address. Only one of those is recoverable by the person looking.
    const out = p.groupIntoProperties([
      job({ id: "A", addr: "12 Barbican Rd." }),
      job({ id: "B", addr: "12 Barbican Road" }),
    ]);
    assert.equal(out.length, 2);
  });

  test("jobs with no address split by parish, not into one pile", () => {
    const out = p.groupIntoProperties([
      job({ id: "A", addr: null, parish: "Portmore" }),
      job({ id: "B", addr: "", parish: "St Ann" }),
      job({ id: "C", addr: null, parish: "Portmore" }),
    ]);
    assert.equal(out.length, 2);
    const portmore = out.find((x) => x.label.includes("Portmore"));
    assert.equal(portmore.jobs.length, 2);
    assert.equal(portmore.unidentified, true);
  });

  test("an unidentified property says so in its label rather than inventing one", () => {
    const out = p.groupIntoProperties([job({ addr: null, parish: "Kingston" })]);
    assert.match(out[0].label, /Address not given/);
  });

  test("no address and no parish still groups, and still says so", () => {
    const out = p.groupIntoProperties([job({ addr: null, parish: null })]);
    assert.equal(out.length, 1);
    assert.equal(out[0].label, "Address not given");
  });
});

describe("what counts as open", () => {
  test("a cancelled job is not open even if the flag says so", () => {
    assert.equal(p.isOpenJob(job({ status: "cancelled", open: true })), false);
  });
  test("a job past stage 0 is open even with the flag down", () => {
    assert.equal(p.isOpenJob(job({ open: false, stage: 2, status: "in_progress" })), true);
  });
});

describe("ordering", () => {
  test("a property with something happening comes before a quiet one", () => {
    const out = p.groupIntoProperties([
      job({ id: "quiet", addr: "1 Quiet St", open: false, stage: 0, status: "closed", updated_at: "2026-09-03T10:00:00Z" }),
      job({ id: "busy", addr: "2 Busy St", open: true, updated_at: "2026-08-01T10:00:00Z" }),
    ]);
    assert.equal(out[0].label, "2 Busy St", "an open job outranks a more recent quiet one");
  });

  test("a named property outranks an unidentified one, all else equal", () => {
    const out = p.groupIntoProperties([
      job({ id: "A", addr: null, parish: "Kingston", open: true, updated_at: "2026-09-01T10:00:00Z" }),
      job({ id: "B", addr: "9 Real Road", open: true, updated_at: "2026-09-01T10:00:00Z" }),
    ]);
    assert.equal(out[0].label, "9 Real Road");
  });
});

describe("summary", () => {
  test("counts properties, the identified ones, and open jobs", () => {
    const out = p.groupIntoProperties([
      job({ id: "A", addr: "1 A St", open: true }),
      job({ id: "B", addr: "1 A St", open: false, stage: 0, status: "closed" }),
      job({ id: "C", addr: null, parish: "St Ann", open: true }),
    ]);
    const s = p.portfolioSummary(out);
    assert.deepEqual(s, { properties: 2, identified: 1, openJobs: 2, jobs: 3 });
  });
});

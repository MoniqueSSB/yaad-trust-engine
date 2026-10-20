/**
 * Tests for lib/jobs/worker-fee.ts: which worker-side rate the page shows.
 *
 * It must agree with public.worker_fee_rate() (20261004150246): 5% on work
 * agreed before app_settings.worker_fee_7pc_from (2026-10-04 00:00 UTC),
 * 7% from then on, and 7% when there is no date. Display only.
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

let f;
let a;
before(async () => {
  f = await import(pathToFileURL(join(HERE, "../lib/jobs/worker-fee.ts")).href);
  a = await import(pathToFileURL(join(HERE, "../lib/jobs/addon.ts")).href);
});

describe("the switch moment", () => {
  test("is the live app_settings value, 4 Oct 2026 midnight UTC", () => {
    assert.equal(f.WORKER_FEE_7PC_FROM, "2026-10-04T00:00:00Z");
  });
});

describe("which rate applies", () => {
  test("work agreed before 4 Oct 2026 is 5%", () => {
    assert.equal(f.workerFeeRate("2026-09-20T10:00:00+00:00"), 0.05);
    assert.equal(f.workerFeeRate("2026-10-03T23:59:59+00:00"), 0.05);
  });
  test("work agreed from 4 Oct 2026 is 7%", () => {
    assert.equal(f.workerFeeRate("2026-10-04T00:00:00+00:00"), 0.07);
    assert.equal(f.workerFeeRate("2026-10-19T08:30:00.123+00:00"), 0.07);
  });
  test("no date, or one that will not read, is today's 7%", () => {
    assert.equal(f.workerFeeRate(null), 0.07);
    assert.equal(f.workerFeeRate(undefined), 0.07);
    assert.equal(f.workerFeeRate("not a date"), 0.07);
  });
  test("the page writes it as 5% or 7%", () => {
    assert.equal(f.workerFeePct(0.05), "5%");
    assert.equal(f.workerFeePct(0.07), "7%");
  });
});

describe("an add-on is paid at the rate it was agreed at", () => {
  test("agreed before 4 Oct: J$26,000 less 5% is J$24,700", () => {
    assert.equal(a.addonWorkerPay(26000, "2026-10-01T12:00:00+00:00"), 24700);
  });
  test("agreed from 4 Oct: J$26,000 less 7% is J$24,180", () => {
    assert.equal(a.addonWorkerPay(26000, "2026-10-05T12:00:00+00:00"), 24180);
  });
});

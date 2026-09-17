/**
 * Tests for lib/portal/payout-status.ts, the one line in the worker portal
 * that says whether Yaadly can pay them yet.
 *
 * Why this file exists. The line must never say "ready" before a person at
 * Yaadly has checked the details by phone. A worker told they are ready
 * expects money; the call back is the check that stops a payment going to a
 * wrong or fraudulent account. If this assertion has to be loosened to make
 * a change pass, the change is wrong.
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
  p = await import(pathToFileURL(join(HERE, "../lib/portal/payout-status.ts")).href);
});

describe("payoutReadiness", () => {
  test("Stripe ready but no call back is not ready", () => {
    assert.equal(p.payoutReadiness({ stripe_recipient_status: "ready" }).state, "awaiting_call");
  });

  test("Wise details but no call back is not ready", () => {
    assert.equal(p.payoutReadiness({ wise_recipient_set_at: "2026-09-15" }).state, "awaiting_call");
  });

  test("a call back with no details given is not ready either", () => {
    assert.equal(p.payoutReadiness({ bank_callback_at: "2026-09-15" }).state, "not_set_up");
  });

  test("details given and checked by phone is ready", () => {
    assert.equal(
      p.payoutReadiness({ wise_recipient_set_at: "2026-09-14", bank_callback_at: "2026-09-15" }).state,
      "ready",
    );
  });

  test("a half finished Stripe setup says so", () => {
    assert.equal(p.payoutReadiness({ stripe_recipient_status: "needs_info" }).state, "stripe_unfinished");
  });

  test("no profile at all is not set up", () => {
    assert.equal(p.payoutReadiness(null).state, "not_set_up");
  });
});

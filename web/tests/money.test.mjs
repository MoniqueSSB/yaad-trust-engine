/**
 * Tests for lib/money.ts.
 *
 * This module replaced ten hand written formatters, and the reason it exists
 * is that they disagreed: seven rounded and three did not, so one job could
 * read J$1,234,567.89 in one panel and J$1,234,568 in another on the same
 * screen. These tests are what stop that coming back one component at a time.
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
  m = await import(pathToFileURL(join(HERE, "../lib/money.ts")).href);
});

describe("jmd", () => {
  test("rounds, always, which is the whole point of this module", () => {
    assert.equal(m.jmd(1234567.89), "J$1,234,568");
    assert.equal(m.jmd(0.4), "J$0");
    assert.equal(m.jmd(0.5), "J$1");
  });

  test("groups thousands", () => {
    assert.equal(m.jmd(1000), "J$1,000");
    assert.equal(m.jmd(999), "J$999");
  });

  test("zero is a real figure, not a blank", () => {
    assert.equal(m.jmd(0), "J$0");
  });

  test("never emits a decimal point, whatever it is given", () => {
    for (const n of [1, 1.01, 99.99, 250000.5, 1e6 + 0.49]) {
      assert.doesNotMatch(m.jmd(n), /\./, `jmd(${n}) leaked a decimal`);
    }
  });
});

describe("the null shapes differ on purpose", () => {
  test("jmdOrNull gives null so a component can render nothing", () => {
    assert.equal(m.jmdOrNull(null), null);
    assert.equal(m.jmdOrNull(undefined), null);
    assert.equal(m.jmdOrNull(500), "J$500");
  });

  test("jmdOrBlank gives an empty string so a caller can concatenate", () => {
    assert.equal(m.jmdOrBlank(null), "");
    assert.equal(m.jmdOrBlank(undefined), "");
    assert.equal(m.jmdOrBlank(500), "J$500");
  });

  test("zero survives both, and is never mistaken for absent", () => {
    assert.equal(m.jmdOrNull(0), "J$0");
    assert.equal(m.jmdOrBlank(0), "J$0");
  });
});

describe("amount, for invoices in minor units", () => {
  test("JMD rounds like everything else J$", () => {
    assert.equal(m.amount(123456789, "JMD"), "J$1,234,568");
  });

  test("card currencies keep both decimals, because a statement has them", () => {
    assert.equal(m.amount(14900, "GBP"), "£149.00");
    assert.equal(m.amount(14900, "USD"), "$149.00");
    assert.equal(m.amount(14900, "CAD"), "C$149.00");
  });

  test("an unknown or missing currency falls back to GBP, the client billing currency", () => {
    assert.equal(m.amount(14900, null), "£149.00");
    assert.equal(m.amount(14900, "XXX"), "£149.00");
  });

  test("currency is matched case insensitively", () => {
    assert.equal(m.amount(14900, "jmd"), "J$149");
  });

  test("a missing total says so in words rather than printing a dash", () => {
    assert.equal(m.amount(null, "GBP"), "not set");
    assert.doesNotMatch(m.amount(null, "GBP"), /[—–-]/, "no dash in a money column");
  });

  test("zero is zero, and is not the same answer as 'not set'", () => {
    assert.equal(m.amount(0, "GBP"), "£0.00");
    assert.notEqual(m.amount(0, "GBP"), m.amount(null, "GBP"));
  });
});

describe("gbp, for a plain pence column", () => {
  test("always two decimals, so £149.00 does not render as £149", () => {
    assert.equal(m.gbp(14900), "£149.00");
    assert.equal(m.gbp(14950), "£149.50");
  });
  test("groups thousands", () => {
    assert.equal(m.gbp(123456789), "£1,234,567.89");
  });
});

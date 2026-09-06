/**
 * Tests for lib/portal/price-context.ts, which decides what a client and a
 * worker are told about where a quote sits.
 *
 * Why this file exists, and why it tests COPY as well as logic.
 *
 * Showing a price band to a client is the founding "why" of this business,
 * ending the farrin price, and it is also the closest this product ever gets
 * to the one thing it does not do. Yaadly guarantees project management and
 * oversight judgment; it does not guarantee price estimation, which is
 * quantity surveying. The distance between "here is what we have seen" and
 * "this quote is too expensive" is one careless sentence, and it is a
 * sentence somebody will be tempted to write when a client asks a direct
 * question.
 *
 * So these tests hold the line in words as well as in numbers: no verdict, the
 * sample size always attached, silence rather than a thin claim, and the same
 * text for both sides.
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
  p = await import(pathToFileURL(join(HERE, "../lib/portal/price-context.ts")).href);
});

const obs = (...n) => n.map((labour_jmd) => ({ labour_jmd }));

describe("saying nothing rather than something thin", () => {
  test("no quote figure means no context at all", () => {
    assert.equal(p.priceContext("Roofing", 0, obs(1, 2, 3)).show, false);
    assert.equal(p.priceContext("Roofing", null, obs(1, 2, 3)).show, false);
  });

  test("a trade with no band and too few observations says nothing", () => {
    // Two quotes is not a spread. Showing it would dress noise as evidence.
    const ctx = p.priceContext("Air Conditioning", 50000, obs(40000, 60000));
    assert.equal(ctx.show, false);
  });

  test("observations only count from three upwards", () => {
    assert.equal(p.priceContext("Roofing", 80000, obs(1000, 2000)).observed, null);
    assert.notEqual(p.priceContext("Roofing", 80000, obs(1000, 2000, 3000)).observed, null);
  });
});

describe("the honest gaps stay honest", () => {
  test("a trade with no public price says exactly that, not 'no data'", () => {
    const ctx = p.priceContext("Painting & Decorating", 60000, []);
    assert.equal(ctx.noPublicPrice, true);
    assert.equal(ctx.band, null);
    const s = p.priceSentence(ctx, 60000);
    assert.match(s, /no public price in Jamaica/i, s);
  });

  test("with no public price but real quotes, it leads with the gap then the quotes", () => {
    const ctx = p.priceContext("Painting & Decorating", 60000, obs(40000, 55000, 95000));
    const s = p.priceSentence(ctx, 60000);
    assert.match(s, /no public price in Jamaica/i);
    assert.match(s, /3 real quotes/);
    assert.match(s, /J\$40,000 to J\$95,000/);
  });
});

describe("position, never verdict", () => {
  const band = (labour) => p.priceSentence(p.priceContext("Roofing", labour, []), labour);

  test("inside the band says it sits inside, and names the range", () => {
    const s = band(100000);
    assert.match(s, /sits inside the range/);
    assert.match(s, /J\$75,000 to J\$200,000/);
  });

  test("above the band says it sits above, and still names the range", () => {
    const s = band(400000);
    assert.match(s, /sits above that range/);
  });

  test("below the band says it sits below", () => {
    assert.match(band(10000), /sits below that range/);
  });

  test("NO sentence anywhere passes judgement on the price", () => {
    // The whole line. If any of these words appear, this has stopped being a
    // reference and become an estimate, which is QS work and not Yaadly's.
    const banned = /\b(too (high|low|expensive|cheap)|overpriced|fair price|unfair|good deal|bad deal|rip[- ]?off|should (be|cost)|worth)\b/i;
    for (const labour of [10000, 100000, 400000]) {
      const s = band(labour);
      assert.ok(!banned.test(s), `verdict language in: ${s}`);
    }
    const gap = p.priceSentence(p.priceContext("Painting & Decorating", 60000, obs(1, 2, 3)), 60000);
    assert.ok(!banned.test(gap), `verdict language in: ${gap}`);
  });

  test("every band sentence carries its source, so the reader can weigh it", () => {
    assert.match(band(100000), /Source: /);
  });
});

describe("the caveat", () => {
  test("says plainly that Yaadly does not price the trade work", () => {
    assert.match(p.PRICE_CAVEAT, /does not price the trade work/i);
    assert.match(p.PRICE_CAVEAT, /not a valuation/i);
  });

  test("names the legitimate reasons a quote sits outside a range", () => {
    // Without this it becomes a stick to beat a tradesperson with, and the
    // worker is the one who knows the access is bad.
    assert.match(p.PRICE_CAVEAT, /access/i);
    assert.match(p.PRICE_CAVEAT, /a question worth asking rather than an answer/i);
  });
});

describe("the Mirror Rule", () => {
  test("the sentence does not depend on who is reading it", () => {
    // There is no role argument, and there must not be one. A client told a
    // quote is above typical, while the worker cannot see the same thing and
    // cannot answer it, is a protection with no counterpart.
    assert.equal(p.priceSentence.length, 2, "priceSentence takes (ctx, labour) and no role");
  });
});

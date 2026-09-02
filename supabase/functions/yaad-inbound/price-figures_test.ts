// Proves the figure guard: published prices pass untouched, anything else
// with a currency sign is cut, and the FAQ facts themselves pass, which is
// what stops faq.ts and price-figures.ts drifting apart.
//
// Run: deno test supabase/functions/yaad-inbound/price-figures_test.ts

import { assert, assertEquals } from "jsr:@std/assert@1";
import { NO_PRICE_SENTENCE, priceFigureGuard, unpublishedFigures } from "./price-figures.ts";
import { FAQ_FACTS } from "./faq.ts";
import { scan } from "./guardrails.ts";

Deno.test("published service prices pass word for word", () => {
  const r = priceFigureGuard("A Deposit Protection Check is from £149 and a Condition Report from £245. Full Project Management is 12 to 15% of build cost.");
  assertEquals(r.cut, []);
  assert(r.text.includes("£149"));
});

Deno.test("an invented repair price is cut, the rest of the reply survives", () => {
  const r = priceFigureGuard("I hear the roof leaks in Portland. A job like that usually runs about £800 to £1,200. Which parish is the property in?");
  assertEquals(r.cut, ["£800", "£1,200"]);
  assertEquals(r.text, "I hear the roof leaks in Portland. Which parish is the property in?");
});

Deno.test("J$ and percent figures off the list are cut too", () => {
  assertEquals(unpublishedFigures("call it J$25,000 for labour"), ["J$25,000"]);
  assertEquals(unpublishedFigures("we take 20% of the job"), ["20%"]);
  assertEquals(unpublishedFigures("a 2.5% margin"), ["2.5%"]);
  assertEquals(unpublishedFigures("the minimum is J$3,500 to J$4,500"), []);
});

Deno.test("a reply that was only a price becomes the fixed no-price sentence", () => {
  const r = priceFigureGuard("About £600.");
  assertEquals(r.text, NO_PRICE_SENTENCE);
  assertEquals(scan(NO_PRICE_SENTENCE), []);
});

Deno.test("close enough is not on the list", () => {
  assertEquals(unpublishedFigures("from £150"), ["£150"]);
});

Deno.test("the FAQ facts pass their own guard and the banned-language screen", () => {
  assertEquals(unpublishedFigures(FAQ_FACTS), []);
  assertEquals(scan(FAQ_FACTS), []);
  assert(!/[\u2010-\u2015]/.test(FAQ_FACTS), "no dashes");
  assert(!FAQ_FACTS.includes("`") && !FAQ_FACTS.includes("${"), "safe inside the prompt's template literal");
});

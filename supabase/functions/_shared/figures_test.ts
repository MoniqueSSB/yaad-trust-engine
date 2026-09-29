// The figure rule, tested.
//
// Written 25 September 2026, the day the drafter produced its first real
// Deposit Protection Check and put four sums of money in it, hours after the
// prompt had been rewritten to forbid exactly that. Nothing was wrong with the
// prompt. There was no second layer, and nothing ran on any push to say so.
//
// Two things are proved here:
//   1. the pattern catches a price and leaves the shape of an arrangement,
//      and ordinary counting, completely alone
//   2. the Postgres copy of it is character for character the same rule
//
// The second is the one that rots. The first is the one that did not exist.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { FIGURE_PATTERN, hasFigure, scrub } from "./figures.ts";

// [sentence, is it stating a figure, what it is testing]
const CASES: [string, boolean, string][] = [
  // ── the four that actually got through, 25 September 2026 ──
  ["one figure of J$1,240,000 with no breakdown", true, "the one that started this"],
  ["materials alone will be about J$700,000", true, "J dollar, grouped"],
  ["has already sent J$50,000 as a holding deposit", true, "J dollar again"],
  ["Obtain a dated receipt for the J$50,000 holding deposit", true, "and in the action line"],

  // ── other ways a price arrives ──
  ["The quote is £149 for the check", true, "pounds, symbol"],
  ["He is asking US$3,000 for the roof", true, "US dollar"],
  ["Priced at 700000 JMD", true, "currency code after"],
  ["A day rate of 8000 JMD was mentioned", true, "a day rate is a price"],
  ["He wants fifty thousand dollars up front", true, "number in words"],
  ["It comes to two hundred pounds", true, "hundred, pounds"],
  ["one figure of 1,240,000 with no breakdown", true, "grouped, no currency on it"],
  ["He will need 1,500 blocks", true, "a quantity of materials is banned too"],

  // ── the shape of an arrangement. Rule 4 allows every one of these. ──
  ["Most of the price is payable before any materials are on site", false, "shape, no number"],
  ["60 percent up front, 30 percent at strip out and 10 percent at the end", false, "percentages are structure"],
  ["Payment is in three stages and the last is the smallest", false, "shape in words"],
  ["The whole of it is one figure with no breakdown", false, "says there is a figure without giving it"],
  ["He asked for most of it before he starts", false, "the finding that matters, no figure in it"],

  // ── ordinary counting. None of these may be touched. ──
  ["He said he has a team of four", false, "a count"],
  ["Two of the five latches are missing", false, "counting, blessed by rule 3"],
  ["Six weeks from deposit, he told her", false, "a duration"],
  ["A three bedroom bungalow, empty since March", false, "a count and a month"],
  ["The quote is dated 11 September", false, "a date"],
  ["Six photographs were sent", false, "a count"],
  ["Nothing was agreed in 2026 about the fascia", false, "a year has no comma in it"],
];

Deno.test("every figure in the list is caught", () => {
  for (const [s, want, why] of CASES) {
    if (want) assert(hasFigure(s), `missed (${why}): ${s}`);
  }
});

Deno.test("no ordinary sentence is flagged", () => {
  for (const [s, want, why] of CASES) {
    if (!want) assert(!hasFigure(s), `false positive (${why}): ${s}`);
  }
});

Deno.test("scrubbing removes the figure and leaves a readable sentence", () => {
  const hits: string[] = [];
  const out = scrub("The quote bundles it into one figure of J$1,240,000 with no breakdown.", hits);
  assert(!hasFigure(out), `still states a figure: ${out}`);
  assert(out.includes("[figure removed]"), out);
  assert(out.startsWith("The quote bundles it into one figure of"), out);
  assertEquals(hits.length, 1);
});

Deno.test("scrubbing leaves a clean sentence exactly as it was", () => {
  const hits: string[] = [];
  const s = "He asked for most of it before he starts, and nothing is in writing.";
  assertEquals(scrub(s, hits), s);
  assertEquals(hits.length, 0);
});

Deno.test("nothing scrubbed still states a figure", () => {
  const hits: string[] = [];
  for (const [s] of CASES) {
    assert(!hasFigure(scrub(s, hits)), `survived the scrub: ${s}`);
  }
});

// The Postgres copy. has_figure() runs inside the issue gate, where no test
// here can reach it, so this reads the SQL out of the migration and compares
// it to the string above, character for character.
Deno.test("the Postgres copy of the rule is the same rule", () => {
  const dir = new URL("../../migrations/", import.meta.url);
  const defining: string[] = [];
  for (const e of Deno.readDirSync(dir)) {
    if (!e.isFile || !e.name.endsWith(".sql")) continue;
    if (Deno.readTextFileSync(new URL(e.name, dir)).includes("function public.has_figure")) {
      defining.push(e.name);
    }
  }
  assert(defining.length > 0, "no migration defines has_figure()");
  defining.sort();
  const sql = Deno.readTextFileSync(new URL(defining[defining.length - 1], dir));
  const body = sql.slice(sql.indexOf("function public.has_figure"));
  assert(
    body.includes("$fig$" + FIGURE_PATTERN + "$fig$"),
    "the pattern in the migration is not the pattern in figures.ts",
  );
});

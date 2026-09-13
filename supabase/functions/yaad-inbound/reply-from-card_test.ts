// The reply written without a model, and the rules it still has to keep.
//
// Run: deno test --allow-read supabase/functions/

import { assert, assertEquals } from "jsr:@std/assert@1";
import { missingFrom, replyFromCard, type Card } from "./reply-from-card.ts";
import { isClean } from "./guardrails.ts";
import { unpublishedFigures } from "./price-figures.ts";
import { unkeepableSentences } from "./promises.ts";

const CARDS: Card[] = [
  {},
  { scope: "the ceiling in the back bedroom is leaking after heavy rain", trade: "Roofing" },
  { scope: "water coming through the roof", parish: "Portland" },
  { scope: "septic backing up into the yard", parish: "Kingston", access_note: "her nephew Delroy" },
  { title: "Grille replacement", trade: "Grille & Gate Welding" },
  { trade: "Plumbing" },
  { scope: "x".repeat(400), parish: "St Thomas" },
];

Deno.test("it proves they were heard rather than starting over", () => {
  const out = replyFromCard(CARDS[1], "gathering");
  assert(out.includes("back bedroom"), `should quote their own words back: ${out}`);
  assert(!/what needs doing/i.test(out), "must not ask what they have just told us");
});

Deno.test("it asks for the missing things, at most two", () => {
  const out = replyFromCard(CARDS[1], "gathering");
  assert(/parish/i.test(out), `should ask the parish: ${out}`);
  assert((out.match(/\?/g) || []).length <= 1, "one question mark, not an interrogation");
});

Deno.test("it stops asking for what it already has", () => {
  assertEquals(missingFrom(CARDS[3]).length, 0);
  const out = replyFromCard(CARDS[3], "gathering");
  assert(!out.includes("?"), `nothing left to ask: ${out}`);
});

Deno.test("a read-back names everything known and invents nothing", () => {
  const out = replyFromCard(CARDS[3], "confirming");
  assert(/read that back/i.test(out));
  assert(out.includes("Kingston"));
  assert(out.includes("Delroy"));
});

Deno.test("an empty card still says something usable", () => {
  const out = replyFromCard(CARDS[0], "gathering");
  assert(out.length > 20, out);
  assert(/what needs doing/i.test(out));
});

Deno.test("nothing it can produce breaks a guard", () => {
  // This is the whole reason it is a module with a test rather than a string
  // built inline: it is a reply going to a real person on a real phone.
  for (const card of CARDS) {
    for (const stage of ["gathering", "confirming", "done"] as const) {
      const out = replyFromCard(card, stage);
      assert(isClean(out), `banned language in: ${out}`);
      assertEquals(unpublishedFigures(out).length, 0, `a figure appeared in: ${out}`);
      assertEquals(unkeepableSentences(out).length, 0, `a promise appeared in: ${out}`);
      assert(!/[‐-―]/.test(out), `dash character in: ${out}`);
      assert(out.length < 400, `too long for a phone screen: ${out.length}`);
      assert(!/\s{2,}/.test(out), `double spacing in: ${out}`);
    }
  }
});

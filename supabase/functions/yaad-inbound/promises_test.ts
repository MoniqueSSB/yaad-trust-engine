// What the assistant is not allowed to promise, and what it must still be
// allowed to say. The second half matters as much as the first: a stripper
// that eats the read-back is worse than no stripper, because the read-back is
// the one thing standing between a client and a job written up wrong.
//
// Run: deno test --allow-read supabase/functions/

import { assert, assertEquals } from "jsr:@std/assert@1";
import { isUnkeepable, stripPromises, unkeepableSentences } from "./promises.ts";

Deno.test("the model's own what-happens-next is cut from the end", () => {
  const out = stripPromises(
    "Got it, the back bedroom ceiling is leaking after heavy rain. I will pass this on to the team.",
  );
  assertEquals(out, "Got it, the back bedroom ceiling is leaking after heavy rain.");
});

Deno.test("a date promise is cut from the middle, where the tail pass never looked", () => {
  const out = stripPromises(
    "Got that, the roof over the kitchen. Someone will be out to you tomorrow. Which parish is the property in?",
  );
  assertEquals(out, "Got that, the roof over the kitchen. Which parish is the property in?");
});

Deno.test("promises about how good the work will be are cut", () => {
  for (const said of [
    "We guarantee the work for a year.",
    "The repair is warranted against leaks.",
    "Rest assured the worker is fully insured.",
    "I promise you will be happy with it.",
    "It is risk-free.",
  ]) {
    assert(isUnkeepable(said), `should have been cut: ${said}`);
  }
});

Deno.test("the client's own deadline survives, because it is theirs and not a promise", () => {
  // Urgency is one of the things intake exists to collect. Cutting it out of
  // the read-back would damage the read-back to protect against nothing.
  const said = "You need the back bedroom done this week before your tenant moves in.";
  assert(!isUnkeepable(said), "the client's own timescale must not be cut");
  assertEquals(stripPromises(said), said);
});

Deno.test("a bare timescale with nobody committing to it survives", () => {
  const said = "The leak started about three weeks ago.";
  assert(!isUnkeepable(said));
});

Deno.test("the published Guarantee and Support fee is not mistaken for a promise", () => {
  // It is the real, published name of a real charge on yaadly.co.uk/payments.
  const said = "The price includes the Guarantee and Support fee.";
  assert(!isUnkeepable(said), "the published charge name must survive");
});

Deno.test("an ordinary intake reply is untouched", () => {
  const said =
    "Got it, the grille on the front window is rusted through. "
    + "Which parish is the property in, and who can let a worker in?";
  assertEquals(stripPromises(said), said);
});

Deno.test("a reply that was nothing but promises still says something", () => {
  // Empty on WhatsApp is indistinguishable from the message vanishing.
  const out = stripPromises("Someone will call you tomorrow. We guarantee the work.");
  assert(out.length > 0, "the stripper must never return an empty reply");
});

Deno.test("what was cut can be named, so a cut is never silent", () => {
  const cut = unkeepableSentences(
    "Got that. A worker will be there tomorrow. We guarantee it. Which parish?",
  );
  assertEquals(cut.length, 2);
});

Deno.test("empty in, empty out, without throwing", () => {
  assertEquals(stripPromises(""), "");
  assertEquals(unkeepableSentences("").length, 0);
});

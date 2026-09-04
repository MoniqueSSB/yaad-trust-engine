// The two ways out of a greedy lane, and everything that must NOT open one.
//
// The negative half is the important half. These hatches sit in front of the
// client comment lane and the worker evidence lane, so a false positive means
// a real complaint about a stage, or a real site update, silently stops being
// filed and turns into a fresh intake instead. That fails quietly and in the
// direction nobody checks.
//
// Run: deno test --allow-read supabase/functions/

import { assert } from "jsr:@std/assert@1";
import { shouldEscapeLane, wantsAPerson, wantsFreshJob } from "./escape-hatch.ts";

Deno.test("a client naming a different property gets out of the comment lane", () => {
  for (const said of [
    "I have a new job for you, the tap at my mother's place",
    "This is about another property in Portmore",
    "Different house this time",
    "I have a separate problem at the other address",
    "Nothing to do with this job, my gate is broken",
  ]) {
    assert(wantsFreshJob(said), `should have escaped: ${said}`);
  }
});

Deno.test("a real comment on the evidence never escapes", () => {
  for (const said of [
    "The new tiles look good but there is a gap by the door",
    "P2 still has a gap in it",
    "I am not happy with the paint job",
    "There is a new crack since the last photo",
    "That is not what we agreed",
    "The job is not finished",
  ]) {
    assert(!wantsFreshJob(said), `must stay a comment: ${said}`);
    assert(!shouldEscapeLane(said), `must stay a comment: ${said}`);
  }
});

Deno.test("a worker asking for a person gets out of the evidence lane", () => {
  for (const said of [
    "Can I speak to someone please",
    "I need to talk to Monique",
    "Is this a bot",
    "Let me deal with a real person",
  ]) {
    assert(wantsAPerson(said), `should have escaped: ${said}`);
  }
});

Deno.test("an ordinary site update is never mistaken for asking for a person", () => {
  for (const said of [
    "Finished the second coat today, gate was locked so I went round the back",
    "Rain stopped me at midday, will pick up tomorrow",
    "The client met me on site and showed me the back room",
    "Sending photos now",
  ]) {
    assert(!wantsAPerson(said), `must stay evidence: ${said}`);
    assert(!shouldEscapeLane(said), `must stay evidence: ${said}`);
  }
});

Deno.test("empty and rubbish input do not open a hatch", () => {
  for (const said of ["", "   ", "ok", "👍", "yes"]) {
    assert(!shouldEscapeLane(said), `must not escape: ${JSON.stringify(said)}`);
  }
});

Deno.test("the client hatch and the person hatch are both wired into shouldEscapeLane", () => {
  assert(shouldEscapeLane("I have a new job"));
  assert(shouldEscapeLane("can I speak to a real person"));
});

// A simple question outside the fixed answers: what may go to the model, what
// never does, and what of the model's reply may be sent.
//
// The second half matters most. A money question answered by a model is the
// failure; a simple question sent to a person is only a minute of her time.
//
// Run: deno test --allow-read --allow-env supabase/functions/

import { assert, assertEquals } from "jsr:@std/assert@1";
import { clockAnswer, needsAPerson, promisesAWorker, NOT_COVERED, OFF_SCRIPT_CLOSE, OFF_SCRIPT_SYSTEM, screenOffScript } from "./off-script.ts";
import * as guardrails from "./guardrails.ts";

Deno.test("money, a client, harm or a decision about the work always goes to a person", () => {
  for (const said of [
    "can i change my bank details",
    "why have i not been paid",
    "where is my payment",
    "how much am i getting for this job",
    "the owner said to change the colour, is that ok",
    "can i start the second stage tomorrow",
    "what should i do, the client is refusing to let me in",
    "can i charge extra for the ceiling",
    "what happens if i damage something",
    "is my score affected",
    "is J$20,000 right for this",
    "mi nuh get paid yet, wah gwaan",
  ]) {
    assert(needsAPerson(said), `must go to a person: ${said}`);
  }
});

Deno.test("a simple question about how Yaadly works may be answered", () => {
  for (const said of [
    "what is a completion report",
    "is it free to join",
    "what does stage mean",
    "how do i send a voice note",
    "do i need an app",
    "which parishes do you work in",
    "what is the midnight work log",
  ]) {
    assert(!needsAPerson(said), `may be answered from the facts: ${said}`);
  }
});

Deno.test("the clock is answered by code, in both places", () => {
  // 17:15 UTC on 29 Sep 2026: 12:15 in Jamaica (no daylight saving), 18:15 BST.
  const now = new Date("2026-09-29T17:15:00Z");
  const a = clockAnswer("what time is it in jamaica", now) ?? "";
  assert(a.includes("12:15"), a);
  assert(a.includes("6:15"), a);
  assert(a.includes("Tuesday 29 September"), a);
  assert(clockAnswer("wha time it is", now));
  assert(clockAnswer("what is the date today", now));
  // Either side of midnight the two places are on different days.
  const late = clockAnswer("what time is it", new Date("2026-09-30T01:30:00Z")) ?? "";
  assert(late.includes("Tuesday 29 September") && late.includes("Wednesday 30 September"), late);
});

Deno.test("a question about when to be somewhere is not a question about the clock", () => {
  for (const said of ["wha time di client want mi come", "what time should i start", "what time does the hardware store open", "done by lunch time"]) {
    assertEquals(clockAnswer(said), null, said);
  }
});

Deno.test("what the model wrote is sent whole or not at all", () => {
  assertEquals(screenOffScript("Joining is free and quoting is free.").why, "ok");
  assertEquals(screenOffScript("<think>hmm</think>Joining is free.").text, "Joining is free.");
  assertEquals(screenOffScript(NOT_COVERED).text, null);
  assertEquals(screenOffScript("not_covered.").text, null);
  assertEquals(screenOffScript("I am not sure. NOT_COVERED").text, null);
  assertEquals(screenOffScript("").why, "empty");
  assertEquals(screenOffScript("Your money is held in escrow until the work is approved.").why, "banned_language");
  assertEquals(screenOffScript("Yaadly guarantees the work.").text, null);
  assertEquals(screenOffScript("You will be paid by Friday.").text, null);
  assertEquals(screenOffScript("The fee is 20% of the job.").why, "unpublished_figure");
  assertEquals(screenOffScript("It costs £60 a visit.").why, "unpublished_figure");
  assertEquals(screenOffScript("x".repeat(601)).why, "too_long");
});

Deno.test("a dash the model wrote never reaches a worker", () => {
  const out = screenOffScript("Joining is free \u2014 quoting is free too.").text ?? "";
  assert(out && !/[‐-―]/.test(out), out);
});

Deno.test("the instructions and the fixed close pass the language screen themselves", () => {
  assertEquals(guardrails.scan(OFF_SCRIPT_CLOSE).length, 0);
  assert(OFF_SCRIPT_SYSTEM.includes(NOT_COVERED));
  assert(OFF_SCRIPT_SYSTEM.includes("within 7 days of a named person at Yaadly signing the stage off"));
  assert(!/[\u2013\u2014]/.test(OFF_SCRIPT_SYSTEM + OFF_SCRIPT_CLOSE), "no dashes");
});

Deno.test("an answer that names a day, or says something is settled, is a promise", () => {
  for (const said of [
    "You will be paid by Friday.",
    "Your payment is on its way.",
    "The stage has been approved.",
    "The client sees it tomorrow.",
    "Someone replies within 2 hours.",
    "It will be sorted soon.",
  ]) {
    assert(promisesAWorker(said), `is a promise: ${said}`);
    assertEquals(screenOffScript(said).text, null, said);
  }
  // The published sentence itself, and plain description, are not.
  for (const said of [
    "Paid by Yaadly, not by the client, within 7 days of a named person at Yaadly signing the stage off, by bank transfer.",
    "The client sees the report once you have replied 1.",
    "Joining is free and there is never a charge for a lead.",
  ]) {
    assert(!promisesAWorker(said), `is not a promise: ${said}`);
    assertEquals(screenOffScript(said).why, "ok", said);
  }
});

Deno.test("the facts say what the check-in ask actually does", async () => {
  const { WORKER_HOW_TO } = await import("./off-script.ts");
  assert(!WORKER_HOW_TO.includes("Nothing waits on it"), "the facts say nothing waits on a location, while the check-in ask holds photos 24 hours");
  assert(WORKER_HOW_TO.includes("24 hours") && WORKER_HOW_TO.includes("skip"), "the facts do not say how the check-in ask works");
});

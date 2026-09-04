// The split stays split, and the budget stays wired.
//
// Same shape as the "the gate is wired, and stays wired" tests in
// _shared/guardrails_test.ts, and for the same reason. The unit tests beside
// this one prove the Deadline arithmetic and the model-free reply work. They
// prove nothing about either being switched on, and the realistic failure here
// is not a broken function, it is somebody merging the two calls back into one
// while making the file tidier, or handing a step its own fixed timeout again
// because that reads simpler than asking for a slice.
//
// If one of these goes red, the change is wrong, not the test.
//
// Run: deno test --allow-read supabase/functions/

import { assert, assertEquals } from "jsr:@std/assert@1";

const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("there are two model calls, doing two different jobs", () => {
  assert(src.includes("async function classifyTheJob("), "the classifier is gone or renamed");
  assert(src.includes("async function composeReply("), "the writer is gone or renamed");
  assert(!src.includes("async function readTheJob("), "the combined call is back");
});

Deno.test("the classifier asks for facts and never for a reply", () => {
  const prompt = src.slice(src.indexOf("const CLASSIFY_SYSTEM"), src.indexOf("/** Extraction only."));
  assert(prompt.length > 200, "CLASSIFY_SYSTEM is gone or renamed");
  assert(!/"reply"/.test(prompt), "a reply field is back in the classifier's schema");
  assert(prompt.includes('"enough"'), "the classifier stopped deciding whether there is enough");
});

Deno.test("the writer returns prose, with no envelope to fail at", () => {
  const body = src.slice(src.indexOf("async function composeReply("), src.indexOf("/** Resend's email.received"));
  assert(body.length > 200, "composeReply is gone or renamed");
  assert(!body.includes("match(/\\{"), "the writer is brace matching again, which is what broke before");
  assert(!body.includes("JSON.parse(m[0])"), "the writer is parsing a JSON envelope again");
});

Deno.test("every slow step draws on the one request budget", () => {
  // The failure this replaced: a 90 second transcription behind a 45 second
  // media fetch behind a 25 second model call, in a webhook Twilio abandons at
  // fifteen. Each number sensible on its own, nobody owning the total.
  assert(src.includes("new Deadline()"), "the request budget is not being taken");
  for (const dead of ["AbortSignal.timeout(90000)", "AbortSignal.timeout(25000)"]) {
    assert(!src.includes(dead), `a fixed timeout is back on the reply path: ${dead}`);
  }
  for (const call of ["classifyTheJob", "composeReply", "transcribeUrl"]) {
    const at = src.indexOf(`async function ${call}(`);
    assert(at > 0, `${call} is gone`);
    assert(src.slice(at, at + 3000).includes("deadline.signal("),
      `${call} no longer asks the budget for a slice`);
  }
});

Deno.test("a writer that could not run still leaves the client a real reply", () => {
  assert(src.includes("replyFromCard("), "the model-free fallback is not wired in");
  const at = src.indexOf("let written = card ? await composeReply(");
  assert(at > 0, "the writer is not called where the stage is known");
  const after = src.slice(at, at + 600);
  assert(after.includes("replyFromCard(card, stage)"),
    "a failed or skipped writer no longer falls back to the card");
});

Deno.test("the trace can tell the two failure modes apart", () => {
  // "the model wrote nothing" and "the model was never asked" look identical
  // from the outside and want completely different fixes.
  for (const attr of ["yaadly.reply.source", "yaadly.request.spent_ms", "yaadly.agents_paused"]) {
    assert(src.includes(attr), `${attr} is no longer recorded`);
  }
  assertEquals(src.includes('"yaadly.model.job": "classify"'), true);
  assertEquals(src.includes('"yaadly.model.job": "compose"'), true);
});

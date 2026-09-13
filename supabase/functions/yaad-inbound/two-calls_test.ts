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
  const at = src.indexOf("let written = await composeReply(");
  assert(at > 0, "the writer is not called where the stage is known");
  const after = src.slice(at, at + 900);
  assert(after.includes("replyFromCard(card, stage)"),
    "a failed or skipped writer no longer falls back to the card");
});

Deno.test("a classifier that could not run still leaves the client a real reply", () => {
  // THE ANCHOR ABOVE USED TO READ "let written = card ? await composeReply(",
  // and that `card ? ` was the defect, frozen into an assertion by a test
  // written to protect the writer's fallback and not thinking about the
  // classifier's. Corrected 6 September 2026, with this test added underneath
  // it so the correction cannot be undone by somebody restoring the "safer
  // looking" guard.
  //
  // WHAT THE GUARD ACTUALLY DID. On 6 September a client sent a voice note
  // saying she had a leak in the back room of her property in Portmore. It
  // transcribed correctly and the words are on the thread. The classifier then
  // hit a rate limited model, retried, failed over and ran out of clock, so it
  // returned null. `card ? ... : ""` read that null as "nothing to write
  // about", skipped the writer entirely, and sent the fixed opener written for
  // a message with no readable content: it asked her what needs doing and
  // which parish. She had just said both.
  //
  // The writer never needed the card. It is handed the whole conversation.
  const at = src.indexOf("let written = await composeReply(");
  assert(at > 0, "the writer is gone or moved");
  const call = src.slice(at, at + 120);
  assert(!/card\s*\?/.test(call),
    "the writer is conditional on the classifier again, so a failed extraction " +
    "will take the whole reply down with it and the client gets the opener " +
    "that asks them to repeat what they just said:\n" + call);
  // The signature has to allow it, or the guard comes back to satisfy the type.
  assert(/composeReply\(\s*\n?\s*transcript: string, card: IntakeCard \| null,/.test(src),
    "composeReply no longer accepts a null card, which is how the caller ends " +
    "up guarding on one again");
});

Deno.test("the classifier leaves the writer enough time to actually start", () => {
  // Two numbers that were never checked against each other, found live on the
  // same voice note. The writer asks for signal(4_000, 1_500, 1_200), so it
  // refuses to start with less than 2_700ms left. The classifier was reserving
  // 2_500. A classifier that ran to its full deadline therefore guaranteed the
  // writer was skipped, every time, by two hundred milliseconds.
  //
  // Read out of the source rather than hardcoded, so this stays true when
  // either step is retuned. What is asserted is the relationship, not a
  // number: whatever the classifier promises to leave behind must be at least
  // what the writer needs before it will begin.
  const sliceOf = (fn: string) => {
    const at = src.indexOf(`async function ${fn}(`);
    assert(at > 0, `${fn} is gone`);
    // Anchored on the assignment, not on the bare call. Both of these steps
    // now carry a comment quoting the OTHER one's numbers, to explain why they
    // have to agree, and a looser pattern reads the prose instead of the code.
    const m = src.slice(at, at + 4000)
      .match(/^\s*const sig = deadline\.signal\((\d[\d_]*),\s*(\d[\d_]*),\s*(\d[\d_]*)\)/m);
    assert(m, `${fn} no longer asks the budget for a slice`);
    const n = (s: string) => Number(s.replace(/_/g, ""));
    return { want: n(m![1]), reserve: n(m![2]), floor: n(m![3]) };
  };
  const writer = sliceOf("composeReply");
  const classifier = sliceOf("classifyTheJob");
  assert(
    classifier.reserve >= writer.reserve + writer.floor,
    `the classifier reserves ${classifier.reserve}ms but the writer will not ` +
    `start with less than ${writer.reserve + writer.floor}ms, so a slow ` +
    `classification silently costs the client their reply`,
  );
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

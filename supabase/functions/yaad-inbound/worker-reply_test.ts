// A worker's words while a client's note waits, the screen that reads only
// the system's own words, a database refusal said plainly, and the way out
// of joining. See worker-reply.ts.
//
// Run: deno test --allow-read --allow-env supabase/functions/

import { assert, assertEquals } from "jsr:@std/assert@1";
import { plainRefusal, readWhileNoteWaits, systemWords, wantsToStopJoining } from "./worker-reply.ts";
import { draftReadBack } from "./update-draft.ts";
import * as guardrails from "./guardrails.ts";

const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("a question to Yaadly never goes to the client as a reply", () => {
  for (const t of ["how do I share my location?", "how to send a video", "where do I send the receipt", "what does the client see"]) {
    assertEquals(readWhileNoteWaits(t), "question", t);
  }
});

Deno.test("a bare acknowledgement never goes to the client", () => {
  for (const t of ["ok", "okay", "yes", "thanks", "alright", "cool", "👍", "1", "k"]) {
    assertEquals(readWhileNoteWaits(t), "acknowledgement", t);
  }
});

Deno.test("an ordinary site update is read back, not relayed", () => {
  for (const t of ["finished the second coat this morning", "wall is plastered", "I did the first coat today", "no water on site today", "Tiles laid in the bathroom"]) {
    assertEquals(readWhileNoteWaits(t), "update", t);
  }
});

Deno.test("words that answer the client are a reply", () => {
  for (const t of ["Yes I will fix the gap tomorrow", "sorry about that, I will redo it", "I'll be back Tuesday to finish it", "You are right, I will change it", "mi wi fix it tomorrow", "no problem, I will sort it"]) {
    assertEquals(readWhileNoteWaits(t), "reply", t);
  }
  assertEquals(readWhileNoteWaits("P2 is done now", true), "reply");
  assertEquals(readWhileNoteWaits("P2 is done now", false), "update");
});

Deno.test("the relay screens the worker's words and falls back to the read-back", () => {
  const at = src.indexOf("A worker's plain reply, answering a client's comment");
  assert(at > 0, "the worker reply lane is gone");
  const block = src.slice(at, src.indexOf("Accepting an add-on", at));
  assert(block.includes("readWhileNoteWaits("), "the lane no longer decides what the words are");
  assert(block.includes('kind === "reply"'), "only a reply may be relayed");
  assert(block.includes("screenOwnWords("), "the worker's words reach the client unscreened");
  assert(block.indexOf("screenOwnWords(") < block.indexOf("sendWhatsAppTo("), "screened after sending");
});

Deno.test("a worker quoting his own 100% is read back, not held", () => {
  const typed = draftReadBack("JOB-1", "Kitchen", "wall 100% done");
  assert(guardrails.scan(typed).length > 0, "the quote still carries the phrase, which is the case this covers");
  assertEquals(guardrails.scan(systemWords(typed, ["wall 100% done"])).length, 0);
  // Only his words come out. A banned word the system wrote is still caught.
  assert(guardrails.scan(systemWords(`${typed} fully covered`, ["wall 100% done"])).length > 0);
  // A quote clipped to 600 characters is still recognised as his.
  const long = "wall 100% done " + "and more ".repeat(100);
  assertEquals(guardrails.scan(systemWords(draftReadBack("JOB-1", "K", long), [long])).length, 0);
});

Deno.test("twiml screens the system's words once the worker's are taken out", () => {
  const at = src.indexOf("const twiml = async (");
  assert(at > 0);
  const body = src.slice(at, at + 1400);
  assert(body.includes("guardrails.scan(systemWords(reply, own))"), "twiml is screening the worker's own quoted words again");
});

Deno.test("words a person wrote are passed on, Postgres internals are not", () => {
  const plain = plainRefusal("That number is not the worker on this job.", "Say so here if that is wrong.");
  assertEquals(plain, { text: "That number is not the worker on this job. Say so here if that is wrong.", internal: false });
  for (const raw of [
    "permission denied for function agree_quote_via_whatsapp",
    'relation "public.jobs" does not exist',
    "new row for relation \"evidence\" violates check constraint",
    "JWT expired",
    "invoice %s has no lines",
    "TypeError: fetch failed",
    "",
    null,
  ]) {
    const r = plainRefusal(raw, "Try again in a moment.");
    assert(r.internal, String(raw));
    assert(!r.text.includes(String(raw || "zzz")), r.text);
    assert(r.text.endsWith("Try again in a moment."), r.text);
  }
});

Deno.test("no raw database message reaches anybody in this function", () => {
  assert(!/That did not (?:go through|save): \$\{[a-zA-Z]+\.message\}/.test(src), "a raw error.message is still shown to a person");
});

Deno.test("stop or cancel ends the joining questions", () => {
  for (const t of ["stop", "STOP", "cancel", "Cancel.", "quit", "forget it"]) assert(wantsToStopJoining(t), t);
  for (const t of ["Stop Brown", "no", "skip", "not now", "plumbing"]) assert(!wantsToStopJoining(t), t);
});

Deno.test("asking for a person during the check-in ask goes to a person, not 'could not check in'", () => {
  assert(!src.includes("cannotCheckIn(said) || wantsAPerson(said)"), "a request for a person is still recorded as could not check in");
  const asks = src.match(/if \(wantsAPerson\(said\)\) return twiml\(await askedForAPersonMidCheckIn\(/g) ?? [];
  assertEquals(asks.length, 2, "both the photo and the update check-in asks must hear a request for a person first");
  const helper = src.slice(src.indexOf("const askedForAPersonMidCheckIn"), src.indexOf("// Filing a typed update that has had its 1."));
  assert(helper.includes('tellDeskAWorkerNeedsAPerson(') && helper.includes('"person"'), "the desk is not told a person was asked for");
  assert(!/fileHeldDraft|finalizeEvidenceItem|\.delete\(\)/.test(helper), "asking for a person must not file or drop the waiting evidence");
});

Deno.test("a worker with several live jobs gets the same read-back, and the same check-in ask", () => {
  const at = src.indexOf("if (!evidenceHeld && textUpdateSession");
  assert(at > 0, "the job answer to a typed update is gone");
  const block = src.slice(at, src.indexOf("── a typed update waiting on a reply of 1", at));
  assert(!/from\("evidence"\)\.insert/.test(block), "the words are filed on the job answer, before any 1");
  assert(block.includes('_lane: "update_draft"'), "the words are not held as an update waiting on a 1");
  assert(block.includes("draftReadBack(pick.id, pick.title, words)") && block.includes("readBack("), "the words are not read back");
  // The 1 then goes through fileHeldDraft, which is where the check-in is asked.
  const file = src.slice(src.indexOf("const fileHeldDraft = async"), src.indexOf("const fileHeldDraft = async") + 2000);
  assert(file.includes("checkInOwed(") && file.includes("arrivalAsk("), "the held update no longer asks for the check-in");
});

Deno.test("a known worker never gets the client opener and never mints a client job", () => {
  const at = src.indexOf("a tradesperson who would otherwise reach the client intake");
  assert(at > 0, "the worker catch ahead of the intake is gone");
  const intake = src.indexOf("Voice first: it is how most of these actually arrive");
  assert(at < intake, "the catch must run before the client intake");
  const block = src.slice(at, intake);
  assert(block.includes("isKnownWorkerNumber(") && block.includes("isClientNumber("), "the catch no longer checks the worker list and the client jobs");
  assert(!/from\("jobs"\)\.(?:insert|upsert)/.test(block), "a job is written for a worker");
  assert(block.includes('tellDeskAWorkerNeedsAPerson(') && block.includes('"person"'), "a worker asking for a person is not put in front of one");
  assert(block.includes("no live job on this number"), "a worker with no live job is not told so");
  assert(!block.includes("What needs doing"), "the client opener reaches a worker");
});

Deno.test("the set of notifications that text her phone does not grow", () => {
  // asking_test.ts holds the count; this holds that a worker asking for a
  // person reuses the worker-question text rather than adding a seventh.
  const helper = src.slice(src.indexOf("async function tellDeskAWorkerNeedsAPerson("), src.indexOf("async function notifyAdmin("));
  assertEquals((helper.match(/alsoText:/g) ?? []).length, 1);
  assert(!src.slice(src.indexOf("async function answerOrRaiseWorkerQuestion("), src.indexOf("async function tellDeskAWorkerNeedsAPerson(")).includes("alsoText:"));
});

Deno.test("after the 'a draft is waiting' template, the first reply gets the draft, not a send", async () => {
  const { draftShownLate } = await import("./worker-reply.ts");
  const d = draftShownLate("JOB-1", "Second coat on the front wall is done.");
  assert(d.includes("Second coat on the front wall is done.") && d.includes("Reply 1") && d.includes("Nothing goes to the client until you choose"), d);
  assert(!/[\u2013\u2014]/.test(d));
  assertEquals(guardrails.scan(d).length, 0);
  const at = src.indexOf("if (!evidenceHeld && reportSession && !msg.media.length && msg.text.trim())");
  assert(at > 0, "the report lane is gone");
  const lane = src.slice(at, src.indexOf('rpc("relay_confirmed_report"', at));
  const shown = lane.indexOf("draftNotSeenYet(");
  assert(shown > 0, "a draft only announced by template can be answered unseen");
  assert(shown < lane.indexOf("isBareAcknowledgement(said)") && shown < lane.indexOf("screenOwnWords(said)"), "the draft must be shown before any reply is read as an answer to it");
});

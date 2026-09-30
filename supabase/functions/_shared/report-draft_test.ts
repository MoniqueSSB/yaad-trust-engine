import * as guardrails from "./guardrails.ts";
import { assert, assertEquals } from "jsr:@std/assert@1";
import { canBeACaption, captionsLine, isCameraNote, isUsableCaption, namedNextStep, noCaptionPrompt, plainDraft, unearnedClaims, usableCaptions, reportSentReceipt } from "./report-draft.ts";

// The captions and the draft from the founder's own test, 29 September 2026.
const FILED = ["1", "fixing beam in place", "changing focus", "the work is done for this stage"];
const DRAFT = "The carpentry team has completed the beam installation stage\n\n"
  + "The carpenter has secured the beam in its designated position and completed all tasks required for this phase of work";

Deno.test("a bare menu reply is not a description of the work", () => {
  assertEquals(isUsableCaption("1"), false);
  assertEquals(isUsableCaption(" 2 "), false);
  assertEquals(isUsableCaption(""), false);
  assertEquals(isUsableCaption(null), false);
  assertEquals(isUsableCaption("ok"), false);
  assertEquals(isUsableCaption("fixing beam in place"), true);
});

Deno.test("usable captions keep the order filed and drop repeats", () => {
  assertEquals(usableCaptions([...FILED, "Fixing beam in place"]),
    ["fixing beam in place", "the work is done for this stage"]);
});

Deno.test("a note about the camera is not an account of the work", () => {
  for (const c of ["changing focus", "retake", "bad lighting", "zoomed in", "Blurry one"]) assertEquals(isCameraNote(c), true, c);
});

Deno.test("the camera filter is narrow: real work that mentions those words is kept", () => {
  for (const c of [
    "fixing beam in place",
    "the main focus today was getting the beam level and fixed",
    "fitted the security camera bracket above the front door",
    "flashing fitted round the chimney",
    "angle bracket fixed to the wall plate and the joist",
  ]) assertEquals(isCameraNote(c), false, c);
});

Deno.test("a stray 1 cannot stand as a caption, a sentence can", () => {
  assertEquals(canBeACaption("1"), false);
  assertEquals(canBeACaption("ok"), false);
  assertEquals(canBeACaption("new door hung"), true);
});

Deno.test("the draft from the real test is caught, and it says which words", () => {
  const found = unearnedClaims(DRAFT, usableCaptions(FILED));
  for (const w of ["completed", "secured", "installed", "all tasks", "team", "designated"]) {
    assert(found.includes(w), `${w} should be caught, got ${found.join(",")}`);
  }
});

Deno.test("a claim the worker made himself is his to make", () => {
  assertEquals(unearnedClaims("The beam installation is completed.", ["beam installed and completed today"]), []);
  assertEquals(unearnedClaims("The team fitted the door.", ["we fitted the door"]), []);
});

Deno.test("a draft that stays inside his words passes", () => {
  assertEquals(unearnedClaims("The tradesperson reports fixing a beam in place, and says the work is done for this stage.",
    usableCaptions(FILED)), []);
});

Deno.test("a next step nobody named is dropped, so no follow-up is made from filler", () => {
  assertEquals(namedNextStep("The next step will be for the team to move on to the subsequent stage", usableCaptions(FILED)), "");
  assertEquals(namedNextStep("nothing further", ["coming back tomorrow to hang the door"]), "");
  assertEquals(namedNextStep("", ["coming back tomorrow"]), "");
});

Deno.test("a next step the worker pointed at is kept", () => {
  assertEquals(namedNextStep("Hang the door tomorrow", ["frame is in, coming back tomorrow to hang the door"]), "Hang the door tomorrow");
});

Deno.test("the plain draft is his words and nothing else", () => {
  const d = plainDraft("stage 3", usableCaptions(FILED));
  assert(!d.includes("changing focus"), d);
  assert(d.includes('"fixing beam in place"'), d);
  assertEquals(unearnedClaims(d, usableCaptions(FILED)), []);
  assert(!/[–—]/.test(d), "no dashes");
  assert(plainDraft("stage 3", []).includes("no description"));
});

Deno.test("the captions line is absent when there is nothing to show", () => {
  assertEquals(captionsLine([]), null);
  assert(captionsLine(["fixing beam in place"])!.startsWith("From what you sent:"));
});

Deno.test("a report sent from the page is answered on WhatsApp, with the next step", () => {
  const a = reportSentReceipt("JOB-WEB-1", "Carpentry job", true);
  assert(a.startsWith("Sent to the client, in your words, for JOB-WEB-1 (Carpentry job)."), a);
  assert(a.includes("Next: the client reads it"), a);
  assert(a.includes("Nothing more is needed from you"), a);
});

Deno.test("a report that reached nobody is never called sent", () => {
  const a = reportSentReceipt("JOB-WEB-1", "", false);
  assert(!/^Sent/.test(a) && a.includes("has not reached the client yet"), a);
  assert(a.includes("A person at Yaadly has been told"), a);
});

Deno.test("the receipt promises nothing and passes the language screen", () => {
  for (const reached of [true, false]) {
    const a = reportSentReceipt("JOB-1", "Roof", reached);
    assertEquals(guardrails.scan(a).length, 0, a);
    assert(!/today|tomorrow|\bhours?\b|paid|payment|approved|will approve|guarantee/i.test(a), a);
    assert(!/[\u2013\u2014]/.test(a), a);
  }
});

Deno.test("the no-caption draft is written to the client, and the worker is told apart from it", () => {
  const d = plainDraft("stage 2", []);
  // It is what reaches the client on "Send as written".
  assert(!/\byou\b|\byour\b/i.test(d), `the client's text must not address anybody as you: ${d}`);
  assert(d.includes("stage 2"));
  const p = noCaptionPrompt();
  assert(/what the photos show/.test(p) && /send it as it is/i.test(p), p);
  assert(!/[\u2013\u2014]/.test(d + p), "no dashes");
});

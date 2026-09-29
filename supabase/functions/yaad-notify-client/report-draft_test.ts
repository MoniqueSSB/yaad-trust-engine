import { assert, assertEquals } from "jsr:@std/assert@1";
import { captionsLine, isUsableCaption, namedNextStep, plainDraft, unearnedClaims, usableCaptions } from "./report-draft.ts";

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
    ["fixing beam in place", "changing focus", "the work is done for this stage"]);
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
  assert(d.includes('"fixing beam in place"'), d);
  assertEquals(unearnedClaims(d, usableCaptions(FILED)), []);
  assert(!/[–—]/.test(d), "no dashes");
  assert(plainDraft("stage 3", []).includes("no description"));
});

Deno.test("the captions line is absent when there is nothing to show", () => {
  assertEquals(captionsLine([]), null);
  assert(captionsLine(["fixing beam in place"])!.startsWith("From what you sent:"));
});

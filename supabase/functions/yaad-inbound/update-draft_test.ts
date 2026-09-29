// A worker's typed update is filed only on a reply of 1.
//
// The chat on JOB-WEB-1789253807959 is the fixture: "done", "no",
// "share location" and "1" all went on the record as evidence on 14 and 15
// September 2026. None of them may file on their own again.
//
// Run: deno test --allow-read supabase/functions/

import { assert, assertEquals } from "jsr:@std/assert@1";
import { draftReadBack, readDraftReply, tooShortToBeAnUpdate } from "./update-draft.ts";
import { isBareAcknowledgement } from "./worker-question.ts";

const read = (t: string) => readDraftReply(t, isBareAcknowledgement);

Deno.test("only a reply of 1 files the waiting update", () => {
  assertEquals(read("1"), "file");
  assertEquals(read(" 1 "), "file");
  for (const said of ["yes", "ok", "done", "send it", "11", "one"]) {
    assert(read(said) !== "file", `"${said}" must not file`);
  }
});

Deno.test("no drops the waiting update", () => {
  for (const said of ["no", "No.", "cancel", "delete", "don't"]) assertEquals(read(said), "discard", said);
});

Deno.test("an acknowledgement or a stray character keeps the draft as it is", () => {
  for (const said of ["ok", "thanks", "2", "?", "."]) assertEquals(read(said), "keep", said);
});

Deno.test("real words replace the draft rather than filing", () => {
  for (const said of ["done", "stairs are in and the rail is fixed", "share location"]) {
    assertEquals(read(said), "replace", said);
  }
});

Deno.test("a lone number or character is never an update", () => {
  for (const said of ["1", "2", "", "  ", "?", "!!", "12"]) assert(tooShortToBeAnUpdate(said), said);
  for (const said of ["done", "ok", "rail fixed"]) assert(!tooShortToBeAnUpdate(said), said);
});

Deno.test("the read-back quotes the words, names the job and the one reply that files", () => {
  const s = draftReadBack("JOB-1", "Stair rails", "stage one done, stairs are in");
  assert(s.includes("JOB-1 (Stair rails)"));
  assert(s.includes("\"stage one done, stairs are in\""));
  assert(s.includes("Reply 1"));
  assert(!/[–—]/.test(s), "no dashes in worker copy");
});

/* ── a note about the photographs just filed (20 Sep 2026) ────────────────
   The filing confirmation now invites a comment, and the answer is held and
   read back like any other typed update. Being invited to say something does
   not buy a way past the 17 September rule: the 1 is still the gate. What
   changes is only where the words land, sharing the photographs' batch_id so
   the portal draws the lot as one update. */

Deno.test("a note joining a batch says so, and still files only on a 1", () => {
  const s = draftReadBack("JOB-1", "Stair rails", "the rail was rusted through underneath", true);
  assert(s.includes("with the photos you just sent"), "the worker is not told where it is going");
  assert(s.includes("JOB-1 (Stair rails)"), "the job is no longer named, so it cannot be checked");
  assert(s.includes("Reply 1"), "the gate is gone from the read-back");
  assert(s.includes("Nothing is filed until you reply 1"), "the gate is no longer stated");
  assert(!/[–—]/.test(s), "no dashes in worker copy");
});

Deno.test("a note does not promise that the NEXT photos will carry it too", () => {
  const note = draftReadBack("JOB-1", "Stair rails", "rail was rusted", true);
  const plain = draftReadBack("JOB-1", "Stair rails", "rail was rusted");
  assert(!note.includes("Photos you send next"),
    "a note is attached backwards to photos already filed, so promising the next ones carry it is a lie");
  assert(plain.includes("Photos you send next"),
    "the ordinary read-back lost the forward promise, which is a real behaviour a worker relies on");
});

Deno.test("a note is read exactly like any other draft", () => {
  // Nothing about readDraftReply changes for a note. If this ever needs its
  // own branch, the gate has been moved and the change is wrong.
  assertEquals(read("1"), "file");
  assertEquals(read("no"), "discard");
  assertEquals(read("actually it was the joint, not the rail"), "replace");
});

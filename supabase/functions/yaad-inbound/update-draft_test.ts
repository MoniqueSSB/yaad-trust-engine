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

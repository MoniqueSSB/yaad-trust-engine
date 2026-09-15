// A held number still files evidence; a held number still cannot talk to the
// assistant. Both halves are checked against the source, because the gate is
// a name on an `if`, and the wrong name on the wrong lane fails silently.
//
// Run: deno test --allow-read supabase/functions/

import { assert } from "jsr:@std/assert@1";

const src = Deno.readTextFileSync(new URL("./index.ts", import.meta.url));

Deno.test("the evidence lanes open for a held worker on a live job", () => {
  for (const lane of [
    "!evidenceHeld && reportSession",
    "!evidenceHeld && arrivalSession",
    "!evidenceHeld && textUpdateSession",
    "!evidenceHeld && evSession",
    "!evidenceHeld && hasPin",
    "!evidenceHeld && evidenceMedia.length",
  ]) {
    assert(src.includes(lane), `evidence lane is held for a worker again: ${lane}`);
  }
  assert(src.includes("const evidenceHeld = deskHasThisNumber && !heldWorker;"),
    "evidenceHeld no longer depends on the number being a worker on a live job");
});

Deno.test("what a held number says still goes to a person, not the assistant", () => {
  // The client comment lane, the worker's freeform text lane, and the job
  // alert signup: plain words on a held thread are Monique's conversation.
  for (const lane of [
    "!deskHasThisNumber && alertsSaid",
    "!deskHasThisNumber && !wantsAPerson(msg.text) && !msg.media.length && msg.text.trim()",
    "!deskHasThisNumber && !wantsAPerson(msg.text) && (!msg.media.length || msg.media.every((m) => m.mime.startsWith(\"audio/\")))",
  ]) {
    assert(src.includes(lane), `a text lane opened on a held thread: ${lane}`);
  }
  assert(src.includes("if (prior?.human_handling === true) {"), "the held-for-human branch is gone");
});

// A client on a live job, saying something that is not an approval.
//
// Run: deno test --allow-read --allow-env supabase/functions/

import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  answerClientQuestion, CLIENT_LIVE_STATUSES, CLIENT_OFF_SCRIPT_SYSTEM, clientWord, clientWordReply,
  GONE_TO_YAADLY, type LiveJob, nothingApproved, readsAsProblem, whereItStands,
} from "./client-lane.ts";
import * as guardrails from "./guardrails.ts";
import { unkeepableSentences } from "./promises.ts";
import { unpublishedFigures } from "./price-figures.ts";

const job = (status: string): LiveJob => ({ id: "JOB-WEB-1", title: "Carpentry job", stage: 3, status });

Deno.test("every live status says where the job stands and what is wanted", () => {
  for (const status of CLIENT_LIVE_STATUSES) {
    const s = whereItStands(job(status));
    assert(s.includes("JOB-WEB-1"), s);
    assert(/Nothing|reply|portal|tab/i.test(s), `${status} names no next step: ${s}`);
    assertEquals(guardrails.scan(s).length, 0, s);
    assertEquals(unpublishedFigures(s).length, 0, s);
    assert(!/[–—]/.test(s), s);
    assert(!/tomorrow|today|by (?:mon|tue|wed|thu|fri|sat|sun)|within \d/i.test(s), s);
  }
});

Deno.test("a report waiting is never made to sound approved", () => {
  const s = whereItStands(job("evidence"));
  assert(s.includes("Nothing has been approved"), s);
  assert(s.includes("reply with only the code JOB-WEB-1"), s);
});

Deno.test("thanks, a greeting and a stray ok are told apart, typos forgiven", () => {
  for (const said of ["thanks", "Thank you!", "cheers", "thankss", "bless"]) assertEquals(clientWord(said), "thanks", said);
  for (const said of ["hi", "Hello", "good morning", "hii"]) assertEquals(clientWord(said), "greeting", said);
  for (const said of ["ok", "yes", "no", "nno", "okk", "got it", "great"]) assertEquals(clientWord(said), "bare", said);
  for (const said of ["P2 still has a gap", "when will he finish", "thanks but the door sticks", "yes the door is fine", ""]) {
    assertEquals(clientWord(said), null, said);
  }
});

Deno.test("a yes with a report waiting is told nothing was approved", () => {
  const r = clientWordReply("bare", [job("evidence")]);
  assert(r.includes("Nothing has been approved"), r);
  assert(clientWordReply("thanks", [job("in_progress")]).startsWith("You're welcome. "));
  assert(clientWordReply("greeting", [job("quoted")]).startsWith("Hello. "));
});

Deno.test("with several jobs it asks which, and guesses none", () => {
  const r = clientWordReply("thanks", [job("evidence"), { ...job("in_progress"), id: "JOB-WEB-2" }]);
  assert(r.includes("JOB-WEB-1") && r.includes("JOB-WEB-2") && r.includes("Say which one"), r);
});

Deno.test("a problem with the work is heard as one", () => {
  for (const said of [
    "I am not happy with this", "the tiles are cracked", "he didn't turn up", "this is a mess", "there is a leak under the sink now",
    "the door is broken", "I want a refund", "it is not finished", "di work nuh good", "he overcharged me",
  ]) assert(readsAsProblem(said), said);
  for (const said of ["looks great", "P2 is the one I like", "can he paint it white", "what colour is that", "thanks"]) {
    assert(!readsAsProblem(said), said);
  }
});

Deno.test("the fixed answers cover approving, paying, status, photographs and the number", () => {
  const j = job("evidence");
  assert(answerClientQuestion("how do I approve", j)?.includes("reply here with only the code JOB-WEB-1"));
  assert(answerClientQuestion("how do i pay", j)?.includes("You pay Yaadly, never the tradesperson"));
  assert(answerClientQuestion("can I pay the worker direct?", j)?.includes("never the tradesperson"));
  assert(answerClientQuestion("what happens next", j)?.includes("Nothing has been approved"));
  assert(answerClientQuestion("where can I see the photos", j)?.includes("Evidence tab"));
  assert(answerClientQuestion("how do I stop these whatsapp messages", j)?.includes("Job details tab"));
  // The job's own progress and the tradesperson are a person's to answer.
  assertEquals(answerClientQuestion("when will he finish", j), null);
  assertEquals(answerClientQuestion("is the work any good", j), null);
  assertEquals(answerClientQuestion("how much will the extra cost", j), null);
});

Deno.test("no fixed answer promises, prices or uses banned language", () => {
  const j = job("evidence");
  for (const q of ["how do I approve", "how do i pay", "what happens next", "where can I see the photos", "how do I raise a problem", "remove my number"]) {
    const a = answerClientQuestion(q, j) ?? "";
    assert(a.length > 0, q);
    assertEquals(guardrails.scan(a).length, 0, a);
    assertEquals(unkeepableSentences(a).length, 0, a);
    assertEquals(unpublishedFigures(a).length, 0, a);
    assert(!/[–—]/.test(a), a);
  }
  for (const s of [GONE_TO_YAADLY, nothingApproved(j)]) {
    assertEquals(guardrails.scan(s).length, 0, s);
    assert(!/[–—]/.test(s), s);
  }
});

Deno.test("approving is never described as paying", () => {
  assert(answerClientQuestion("how do I approve", job("evidence"))?.includes("never a payment from you"));
  assert(CLIENT_OFF_SCRIPT_SYSTEM.includes("is never a payment from the client"));
});

Deno.test("the model is told to leave this job, its price and its progress to a person", () => {
  assert(CLIENT_OFF_SCRIPT_SYSTEM.includes("NOT_COVERED"));
  assert(/this particular job, its price, its progress, when it will finish/.test(CLIENT_OFF_SCRIPT_SYSTEM));
  assert(!/[–—]/.test(CLIENT_OFF_SCRIPT_SYSTEM));
});

// 1 Oct 2026, founder: NO, and STOP, when a client does not want to approve.
import { declineReply } from "./client-lane.ts";

Deno.test("NO on a waiting report says nothing was approved and what to do next", () => {
  for (const said of ["no", "NO", "nope", "not yet", "hold on", "don't approve", "noo"]) {
    const r = declineReply(said, job("evidence"));
    assert(r && r.includes("Nothing has been approved on JOB-WEB-1"), said);
    assert(/Next:/.test(r!) && /send only the code JOB-WEB-1/.test(r!), said);
    assertEquals(guardrails.scan(r!).length, 0, r!);
    assert(!/[–—]/.test(r!), r!);
  }
});

Deno.test("STOP is answered as nothing approved, and says how to stop the messages", () => {
  const r = declineReply("stop", job("evidence"))!;
  assert(r.includes("Nothing has been approved"));
  assert(/stop these WhatsApp messages/.test(r) && r.includes("tab=details"));
  assert(!/stop these WhatsApp messages/.test(declineReply("no", job("evidence"))!));
});

Deno.test("NO with no report waiting, or inside a sentence, is left to the other lanes", () => {
  assertEquals(declineReply("no", job("in_progress")), null);
  assertEquals(declineReply("no the tiles are cracked", job("evidence")), null);
  assertEquals(declineReply("JOB-WEB-1", job("evidence")), null);
});

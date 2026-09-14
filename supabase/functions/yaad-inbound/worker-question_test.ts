// A worker's question is never a report and never evidence, and a worker's
// report is never mistaken for a question.
//
// The second half is the one that fails quietly. A false positive here means
// a real site update stops reaching the client and sits on the desk as a
// question nobody asked, so the negative cases are the bulk of this file.
//
// Run: deno test --allow-read supabase/functions/

import { assert, assertEquals } from "jsr:@std/assert@1";
import { answerWorkerQuestion, looksLikeQuestion } from "./worker-question.ts";

Deno.test("a worker asking something is read as a question", () => {
  for (const said of [
    "how do i share my location",
    "How do I send a video?",
    "where do i send the receipt",
    "can i send the video tomorrow",
    "is the client going to see this",
    "what happens now?",
    "weh mi fi send di receipt",
    "wha time di client want mi come",
    "Do I need to send a before photo as well",
    "the gate is locked, what should i do?",
  ]) {
    assert(looksLikeQuestion(said), `should read as a question: ${said}`);
  }
});

Deno.test("a worker's update, answer or acceptance is never read as a question", () => {
  for (const said of [
    "was able to complete stage one but have some issues",
    "did the first coat today",
    "have some issues with the window frame",
    "will finish tomorrow",
    "can not get in, gate locked",
    "done",
    "finished the first coat, second coat tomorrow",
    "A",
    "B",
    "P",
    "1",
    "A P3",
    "before",
    "after P2",
    "the wall is up, photos coming",
    "no",
    "share location",
    "How it went: fine, finished by 4",
    "",
    "   ",
  ]) {
    assert(!looksLikeQuestion(said), `must stay an update: ${said}`);
  }
});

Deno.test("the app answers how to share a location and how to send a video, and nothing else", () => {
  assert(answerWorkerQuestion("how do i share my location")?.includes("Send your current location"));
  assert(answerWorkerQuestion("how mi send di clip")?.includes("record a short clip"));
  // A question about the job, the client or the money is a person's to
  // answer. The app has no fixed string for it and must not invent one.
  assertEquals(answerWorkerQuestion("when do i get paid for stage 1"), null);
  assertEquals(answerWorkerQuestion("is the client happy with the work?"), null);
  assertEquals(answerWorkerQuestion("what should i do about the locked gate"), null);
});

Deno.test("the canned answers carry no banned language and no promise", () => {
  for (const q of ["how do i share my location", "how do i send a video"]) {
    const a = answerWorkerQuestion(q) ?? "";
    assert(a.length > 0);
    assert(!/escrow|100%|guarantee|zero fraud|held safely/i.test(a), `banned language in: ${a}`);
    assert(!/paid|payment|release|approved/i.test(a), `money language in a how-to: ${a}`);
  }
});

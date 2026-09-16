// A worker's question is never a report and never evidence, and a worker's
// report is never mistaken for a question.
//
// The second half is the one that fails quietly. A false positive here means
// a real site update stops reaching the client and sits on the desk as a
// question nobody asked, so the negative cases are the bulk of this file.
//
// Run: deno test --allow-read supabase/functions/

import { assert, assertEquals } from "jsr:@std/assert@1";
import { answerWorkerQuestion, isBareAcknowledgement, looksLikeQuestion, wantsHelpWith } from "./worker-question.ts";

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
  assertEquals(answerWorkerQuestion("what should i do about the locked gate"), null);
  assertEquals(answerWorkerQuestion("can i start the second stage tomorrow"), null);
  assertEquals(answerWorkerQuestion("the owner said to change the colour, is that ok"), null);
});

Deno.test("the simple questions the founder named get an answer from the app itself", () => {
  // 15 Sep 2026: "it should be able to answer simple questions, like how do i
  // share my location, posting a videos".
  assert(answerWorkerQuestion("how do i post a video")?.includes("record a short clip"));
  assert(answerWorkerQuestion("how do i send photos")?.includes("gallery"));
  assert(answerWorkerQuestion("where do i send the receipt")?.includes("receipt"));
  assert(answerWorkerQuestion("what does the client see")?.includes("reply 1"));
  assert(answerWorkerQuestion("what do the letters mean")?.includes("Before is"));
  assert(answerWorkerQuestion("how do i check in on site")?.includes("Arrival Log"));
});

Deno.test("the pay answer is the published fact and nothing more", () => {
  const a = answerWorkerQuestion("when do i get paid") ?? "";
  assert(a.includes("within 7 working days of a named person at Yaadly signing the stage off"));
  assert(a.includes("does not pay in cash"));
  // No amount, no date, no promise that a particular payment is coming.
  assert(!/£|J\$|\d{1,2}\/\d{1,2}|tomorrow|today|on its way|already sent/i.test(a), a);
});

Deno.test("the canned answers carry no banned language", () => {
  for (const q of ["how do i share my location", "how do i send a video", "photos", "receipt", "what happens next", "when do i get paid", "what do the letters mean"]) {
    const a = answerWorkerQuestion(q) ?? "";
    assert(a.length > 0, `no answer for: ${q}`);
    assert(!/escrow|100%|guarantee|zero fraud|held safely|fully covered/i.test(a), `banned language in: ${a}`);
  }
});

Deno.test("a bare acknowledgement is neither a question nor an update", () => {
  for (const said of ["no", "No.", "ok", "okay", "thanks", "yes", "hi", "got it", "seen"]) {
    assert(isBareAcknowledgement(said), `should be an acknowledgement: ${said}`);
    assert(!looksLikeQuestion(said));
  }
  for (const said of ["done", "finished", "no water on site", "ok the wall is up", "yes the client came", "not done yet"]) {
    assert(!isBareAcknowledgement(said), `must stay an update: ${said}`);
  }
});

Deno.test("a short instruction naming something the app explains is a help request", () => {
  for (const said of ["share location", "send location", "location", "send video", "post a video", "photos"]) {
    assert(wantsHelpWith(said), `should be a help request: ${said}`);
  }
  // Long enough to be an update about the work, so it files.
  for (const said of ["receipt for the cement is coming tomorrow", "photos of the finished frame are next", "took the video but the light was bad so redoing it"]) {
    assert(!wantsHelpWith(said), `must stay an update: ${said}`);
  }
});

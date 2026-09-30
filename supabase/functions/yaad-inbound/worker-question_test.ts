// A worker's question is never a report and never evidence, and a worker's
// report is never mistaken for a question.
//
// The second half is the one that fails quietly. A false positive here means
// a real site update stops reaching the client and sits on the desk as a
// question nobody asked, so the negative cases are the bulk of this file.
//
// Run: deno test --allow-read supabase/functions/

import { assert, assertEquals } from "jsr:@std/assert@1";
import { acknowledgementReply, answerWorkerQuestion, asksForPayment, isBareAcknowledgement, looksLikeQuestion, PAY_REQUEST_ANSWER, wantsHelpWith } from "./worker-question.ts";

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
  assert(answerWorkerQuestion("how do i check in on site")?.includes("checks you in on the job for today"));
  // Not "Nothing waits on it": the check-in ask holds photos for 24 hours (arrival-ask.ts).
  assert(!answerWorkerQuestion("how do i share my location")?.includes("Nothing waits on it"));
});

Deno.test("the pay answer is the published fact and nothing more", () => {
  const a = answerWorkerQuestion("when do i get paid") ?? "";
  assert(a.includes("within 7 days of a named person at Yaadly signing the stage off"));
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

// ── 29 September 2026, JOB-WEB-1789253807959 again ─────────────────────────

Deno.test("a doubled letter is still the word that was meant", () => {
  for (const said of ["nno", "noo", "Noo.", "okk", "yess", "thankss", "nnope"]) {
    assert(isBareAcknowledgement(said), `should be an acknowledgement: ${said}`);
  }
  // Pressing doubled letters must not turn a real update into an "ok".
  for (const said of ["on site now", "noon finish", "book the inspection", "too wet to paint", "all good, wall is up", "door fitted"]) {
    assert(!isBareAcknowledgement(said), `must stay an update: ${said}`);
  }
});

Deno.test("a worker asking to be paid is answered, never filed as an update", () => {
  for (const said of [
    "let the client know i am ready for payment",
    "ready for payment",
    "mi ready fi mi money",
    "tell the client to pay me",
    "pay me",
    "waiting on my payment",
    "please release the payment",
    "i need my money",
    "requesting payment for stage 3",
  ]) {
    assert(asksForPayment(said), `should read as asking for payment: ${said}`);
    assert(wantsHelpWith(said), `should be held off the record: ${said}`);
    assertEquals(answerWorkerQuestion(said), PAY_REQUEST_ANSWER);
  }
});

Deno.test("mentioning money in a report is still a report", () => {
  for (const said of [
    "paid for the cement, receipt coming",
    "client paid the deposit so i started",
    "bought the hinges with the materials money",
    "need money for the cement before i can carry on",
    "done, second coat tomorrow",
    "the work is done for this stage",
    "finished the frame and sent the receipt for the lumber, everything that was paid for is on site and stacked in the living room",
  ]) {
    assert(!asksForPayment(said), `must stay an update: ${said}`);
  }
});

Deno.test("the payment answer promises nothing and carries the published sentence", () => {
  const a = PAY_REQUEST_ANSWER;
  assert(a.includes("Paid by Yaadly, not by the client, within 7 days of a named person at Yaadly signing the stage off, by bank transfer."));
  assert(a.includes("nothing has gone to the client"));
  assert(!/£|J\$|tomorrow|today|on its way|already sent|will be paid|you will get/i.test(a), a);
  assert(!/escrow|100%|guarantee|zero fraud|held|fully covered/i.test(a), a);
  assert(!/[\u2013\u2014]/.test(a), "no dashes");
});

Deno.test("a thank you is answered as a thank you", () => {
  // 29 Sep 2026: an update was filed, the worker said thanks, and was told
  // nothing had been filed and asked for another.
  for (const said of ["thanks", "Thanks!", "thank you", "cheers", "bless", "respect", "thankss"]) {
    const after = acknowledgementReply(said, true);
    assert(after.startsWith("You're welcome."), `${said}: ${after}`);
    assert(after.includes("Your update is on the job"), after);
    assert(!/nothing filed|send a few words/i.test(after), after);
    // Nothing filed lately, so nothing is claimed.
    assertEquals(acknowledgementReply(said, false), "You're welcome.");
  }
});

Deno.test("a greeting and a stray ok each get their own reply", () => {
  for (const said of ["hi", "hello", "good morning", "Hey!"]) {
    assert(acknowledgementReply(said, false).startsWith("Hello."), said);
    assert(acknowledgementReply(said, true).startsWith("Hello."), said);
  }
  for (const said of ["ok", "no", "yes", "got it", "nno", "seen"]) {
    assertEquals(acknowledgementReply(said, true), "Nothing is waiting on a reply from you right now. Send a photo, a few words or a voice note when you have an update.", said);
  }
});

Deno.test("no acknowledgement reply claims, promises or asks for anything it should not", () => {
  for (const said of ["thanks", "hi", "ok", "no"]) for (const filed of [true, false]) {
    const a = acknowledgementReply(said, filed);
    assert(!/escrow|100%|guarantee|held|paid|payment|approved|client/i.test(a), a);
    assert(!/[\u2013\u2014]/.test(a), a);
    assert(!looksLikeQuestion(a), a);
  }
});

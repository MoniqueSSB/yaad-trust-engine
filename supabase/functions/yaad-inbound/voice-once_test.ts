// A voice note is transcribed once, and the words are never thrown away.
//
// THE FAILURE THIS EXISTS FOR, found live on 5 September 2026 on a real voice
// note sent to the Yaadly number. The WhatsApp worker lane transcribed the
// audio into a local variable to decide whether a worker was filing an update.
// The number was not a worker's, so the lane dropped through and discarded the
// transcript. The client pipeline below then fetched the same file from Twilio
// and transcribed it a SECOND time, on what was left of a twelve second
// budget, and the slice left for it was shorter than the work takes.
//
// The logs show both calls returning the words, in 1.7s and 3.2s. The second
// caller had already given up at its own deadline. msg.text became
// "[message with no readable text, review manually]", the classifier had
// nothing to classify, and the client was sent the opener that fires when the
// model produced nothing: it asked her to say what she had just said.
//
// Nothing was broken. Two correct pieces of code each did their own job and
// the total was wrong, which is the same shape as the failure deadline.ts
// exists for, one level up.
//
// These are source-level assertions for the same reason two-calls_test.ts is:
// the realistic regression is not a broken function, it is somebody moving the
// transcription back inside a lane while tidying, where its result dies with
// the branch. If one of these goes red, the change is wrong, not the test.
//
// Run: deno test --allow-read supabase/functions/

import { assert, assertEquals } from "jsr:@std/assert@1";

const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

/** Every place the handler asks for a transcription, with the code around it. */
function callSites(text: string): string[] {
  const out: string[] = [];
  let at = text.indexOf("await transcribeUrl(");
  while (at > 0) {
    // Enough either side to see the assignment that keeps the result.
    out.push(text.slice(Math.max(0, at - 200), at + 200));
    at = text.indexOf("await transcribeUrl(", at + 1);
  }
  return out;
}

Deno.test("a transcription is never thrown away", () => {
  const sites = callSites(src);
  assert(sites.length > 0, "nothing transcribes any more");
  for (const site of sites) {
    assert(
      site.includes("msg.text = said"),
      "a transcription result is not being put on the message, so the next lane " +
      "will transcribe the same audio again on a budget that cannot afford it:\n" + site,
    );
  }
});

Deno.test("every transcription is guarded, so one message is transcribed once", () => {
  // Both call sites sit behind "has this message got text yet". The first one
  // to run fills msg.text, which closes the guard on every one after it. That
  // guard is the whole mechanism; without it the calls are independent again.
  for (const site of callSites(src)) {
    assert(
      /if \(!msg\.text[ )]/.test(site),
      "a transcription runs without checking whether the message already has " +
      "text, which is how the same audio gets transcribed twice:\n" + site,
    );
  }
});

Deno.test("the worker lane reads the transcript rather than making its own", () => {
  // Anchored on the audio clause, because a second worker lane above this one
  // opens with the same three checks and only handles typed messages.
  const at = src.indexOf(
    "if (!deskHasThisNumber && !wantsAPerson(msg.text) && (!msg.media.length || msg.media.every",
  );
  assert(at > 0, "the worker update lane is gone or its condition changed");
  const body = src.slice(at, at + 400);
  assert(body.includes("const text = msg.text.trim();"),
    "the worker lane is not reading the shared transcript");
  assert(!body.includes("transcribeUrl("),
    "the worker lane is transcribing on its own again, which is the bug: its " +
    "result dies when the number turns out not to be a worker's");
});

Deno.test("the transcription happens after the lanes that act on a message", () => {
  // Deliberate placement, not an accident of history. Stage approvals,
  // evidence comments and button taps all read msg.text and some of them take
  // a consequential action from it. Handing those a machine transcript is a
  // separate decision with a human gate in it. Approving a stage on the
  // strength of a transcription is exactly the kind of thing CLAUDE.md §2 and
  // §3 exist to stop, so the transcription must stay BELOW them.
  const approval = src.indexOf("approve_stage_via_whatsapp");
  const firstTranscribe = src.indexOf("await transcribeUrl(");
  assert(approval > 0, "the stage approval lane is gone or renamed");
  assert(firstTranscribe > 0, "nothing transcribes any more");
  assert(
    approval < firstTranscribe,
    "a voice note is now transcribed before the stage approval lane, so spoken " +
    "words could approve a stage and release a worker payable without a person " +
    "reading them",
  );
});

Deno.test("a message that could not be transcribed still says so honestly", () => {
  assert(
    src.includes('msg.text = "[message with no readable text, review manually]"'),
    "the honest placeholder is gone, so a failed transcription now looks like " +
    "an empty message instead of one a person needs to read",
  );
});

Deno.test("the flag that tells the desk it was spoken is set where it is transcribed", () => {
  // The Job Card, the desk push and the trace all read `spoken`. It is
  // declared once, above both lanes, so whichever one transcribes sets the
  // same flag.
  assertEquals(src.match(/let spoken = false;/g)?.length, 1,
    "spoken is declared more than once, so one lane's transcription will not be " +
    "visible to the code that reports it");
  for (const site of callSites(src)) {
    assert(site.includes("spoken = true"),
      "a transcription happens without recording that the message was spoken:\n" + site);
  }
});

// ── 6 September 2026, the same failure from the other end ────────────────
//
// The tests above stop the SAME audio being transcribed twice when the first
// attempt succeeds. They could not see the case that actually happened next: a
// first attempt that comes back EMPTY leaves msg.text empty, which leaves
// every guard above open, so the second call site fetched the file from Twilio
// again and transcribed it again. Both attempts were real work and only the
// second returned the words. 5.7 seconds of a 12 second budget, for one short
// note, most of it spent downloading the same file twice. What was left could
// not fit the classifier, and the client was sent the opener that asks her to
// say what she had just said.
//
// The retry is worth keeping: without it there would have been no transcript
// at all. What is not worth keeping is paying for the download twice. So the
// retry moved inside transcribeUrl, where the bytes are already in hand, and
// the caller records that it tried.

Deno.test("the retry happens where the audio already is, not by fetching it again", () => {
  const at = src.indexOf("async function transcribeUrl(");
  assert(at > 0, "transcribeUrl is gone or renamed");
  const body = src.slice(at, src.indexOf("/** Keep what they sent."));
  assert(body.length > 200, "transcribeUrl's body could not be read");
  assert(/const attempt = async \(\)/.test(body),
    "transcribeUrl no longer has a retryable attempt, so a first transcription " +
    "that comes back empty costs a second download of the same audio");
  assertEquals(body.match(/await attempt\(\)/g)?.length, 2,
    "transcribeUrl should try exactly twice on bytes it already holds: once is " +
    "a flaky provider losing a client's words, three times is the budget gone");
  // The retry must still ask the budget for its slice, or it is a fixed
  // timeout wearing a different hat, which is what deadline.ts exists for.
  assert(body.includes("deadline.signal(4_000, 4_500, 1_200)"),
    "the transcription attempt no longer asks the request budget for a slice");
  // One download, inside the function, above both attempts.
  assertEquals(body.match(/await fetch\(url, \{ headers, signal: fetchSig \}\)/g)?.length, 1,
    "the audio is being downloaded more than once inside transcribeUrl");
});

Deno.test("an empty transcription does not reopen the guard on the next call site", () => {
  // The flag is set BEFORE the attempt, deliberately. Setting it after, or
  // only on success, restores exactly the behaviour this exists to stop.
  const at = src.indexOf("msg.transcribeTried = true;");
  assert(at > 0, "nothing records that a transcription was attempted");
  const after = src.slice(at, at + 200);
  assert(after.indexOf("await transcribeUrl(") > 0,
    "the attempt is recorded after the transcription rather than before it, so " +
    "an empty result still leaves the next call site free to fetch the same " +
    "audio again");
  assert(src.includes("if (!msg.text && !msg.transcribeTried && voice)"),
    "the second call site no longer checks whether a transcription was already " +
    "attempted, so an empty first attempt costs a second download");
});

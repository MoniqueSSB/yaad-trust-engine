// The request clock. Tested against a fake now(), so nothing here sleeps.
//
// Run: deno test --allow-read supabase/functions/

import { assert, assertEquals } from "jsr:@std/assert@1";
import { Deadline, REQUEST_BUDGET_MS } from "./deadline.ts";

function at(t: { ms: number }) { return () => t.ms; }

Deno.test("the budget sits inside Twilio's own limit with room to spare", () => {
  // Twilio gives up at about 15 seconds and the sender then gets nothing.
  assert(REQUEST_BUDGET_MS < 15_000, "the budget must not reach Twilio's limit");
  assert(REQUEST_BUDGET_MS >= 10_000, "too tight to fit a transcription and a model call");
});

Deno.test("a fresh deadline hands out what a step asks for", () => {
  const t = { ms: 1000 };
  const d = new Deadline(12_000, at(t));
  assertEquals(d.slice(7_000, 3_500), 7_000);
  assertEquals(d.remaining(), 12_000);
  assert(!d.blown());
});

Deno.test("a step is cut down to what is left, minus what it must leave behind", () => {
  const t = { ms: 0 };
  const d = new Deadline(12_000, at(t));
  t.ms = 8_000;                          // 4s left
  assertEquals(d.slice(7_000, 1_500), 2_500);
});

Deno.test("a step that cannot finish is not started", () => {
  const t = { ms: 0 };
  const d = new Deadline(12_000, at(t));
  t.ms = 11_500;                         // 500ms left, under the floor
  assertEquals(d.slice(5_000, 0, 1_000), 0);
  assertEquals(d.signal(5_000), null, "a skipped step gets null, never a live signal");
});

Deno.test("the reserve is what protects the reply from the step before it", () => {
  const t = { ms: 0 };
  const d = new Deadline(12_000, at(t));
  t.ms = 9_000;                          // 3s left
  // Transcription would happily take all of it and leave nothing to answer with.
  assertEquals(d.slice(9_000, 3_500), 0, "must refuse rather than eat the reply's time");
  // A step reserving less can still run.
  assertEquals(d.slice(9_000, 1_000), 2_000);
});

Deno.test("a blown deadline reports itself and grants nothing", () => {
  const t = { ms: 0 };
  const d = new Deadline(12_000, at(t));
  t.ms = 20_000;
  assert(d.blown());
  assertEquals(d.remaining(), 0);
  assertEquals(d.slice(1_000), 0);
  assertEquals(d.spentMs(), 20_000);
});

Deno.test("a real signal comes back when there is time, and it is an AbortSignal", () => {
  const d = new Deadline(12_000);
  const sig = d.signal(2_000, 500);
  assert(sig instanceof AbortSignal);
  assert(!sig.aborted, "a signal handed out with time left must not already be aborted");
});

Deno.test("the budget only ever goes up, and only where nobody is waiting", () => {
  const t = { ms: 0 };
  const d = new Deadline(12_000, at(t));
  d.raiseTo(90_000);
  assertEquals(d.budgetMs, 90_000, "email has no fifteen second caller");
  d.raiseTo(5_000);
  assertEquals(d.budgetMs, 90_000, "a step already told its slice must not lose it");
});

/* ── the reserves actually add up ────────────────────────────────────────
   These are the numbers yaad-inbound passes to slice(), walked through on a
   fake clock. They are here because four steps sharing twelve seconds is
   arithmetic, and arithmetic done in your head in a comment is how a budget
   ends up over-subscribed and nobody notices until Twilio starts timing out. */

const FETCH     = [3_500, 6_000,   800] as const;  // pull the voice note down
const TRANSCRIBE= [4_000, 4_500, 1_200] as const;  // speech to text
const CLASSIFY  = [5_000, 2_500, 1_500] as const;  // extract the job card
const COMPOSE   = [4_000, 1_500, 1_200] as const;  // write the reply

Deno.test("a plain text message leaves both model calls comfortable", () => {
  const t = { ms: 0 };
  const d = new Deadline(12_000, at(t));
  const c = d.slice(CLASSIFY[0], CLASSIFY[1], CLASSIFY[2]);
  assert(c >= 4_000, `classifier squeezed on an easy request: ${c}`);
  t.ms += 2_500;
  const w = d.slice(COMPOSE[0], COMPOSE[1], COMPOSE[2]);
  assert(w >= 3_000, `writer squeezed on an easy request: ${w}`);
  t.ms += 2_000;
  assert(d.remaining() >= 5_000, "should be finished with time to spare");
});

Deno.test("a voice note reaches a reply even when every step takes all it is given", () => {
  // The worst case, not the likely one: each step runs to its full slice.
  // Fetch, transcribe and classify must all still get real time, because none
  // of them has a fallback. The writer may be dropped here, and that is the
  // design rather than a shortfall: reply-from-card.ts covers it, and the
  // client gets an answer inside Twilio's window instead of silence outside it.
  const t = { ms: 0 };
  const d = new Deadline(12_000, at(t));
  const must: [string, readonly [number, number, number]][] =
    [["fetch", FETCH], ["transcribe", TRANSCRIBE], ["classify", CLASSIFY]];
  for (const [label, [want, reserve, floor]] of must) {
    const got = d.slice(want, reserve, floor);
    assert(got > 0, `${label} was squeezed out entirely, and it has no fallback`);
    t.ms += got;
  }
  t.ms += d.slice(COMPOSE[0], COMPOSE[1], COMPOSE[2]);
  assert(!d.blown(), `the steps over-subscribe the budget: ${d.spentMs()}ms of 12000`);
  assert(d.remaining() >= 1_000, `nothing left for the job write: ${d.remaining()}ms`);
});

Deno.test("when it does run late, the writer is what gets dropped, not the classifier", () => {
  // The writer is the only step whose absence still leaves something true to
  // say. Losing it costs polish. Losing the classifier costs the job.
  const t = { ms: 0 };
  const d = new Deadline(12_000, at(t));
  t.ms = 8_000;                                    // a slow transcription ate the middle
  const c = d.slice(CLASSIFY[0], CLASSIFY[1], CLASSIFY[2]);
  assert(c > 0, "the classifier must survive a slow start");
  t.ms += c;
  assertEquals(d.slice(COMPOSE[0], COMPOSE[1], COMPOSE[2]), 0,
    "the writer must stand down rather than overrun Twilio");
});

Deno.test("email is not held to a limit that only Twilio imposes", () => {
  const t = { ms: 0 };
  const d = new Deadline(12_000, at(t));
  d.raiseTo(90_000);
  t.ms = 20_000;                                   // Resend took its time
  assert(d.slice(CLASSIFY[0], CLASSIFY[1], CLASSIFY[2]) > 0,
    "an email intake must not be degraded to meet a deadline nobody is holding");
});

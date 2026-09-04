// Deno mirror of the guardrail tests in tests/test_engine.py.
//
// The phrases below are the SAME seven the Python side asserts, deliberately.
// Two copies of a rule drift, and a rule that holds in one runtime and not the
// other is worse than no rule because it reads as covered. If somebody loosens
// a pattern in one file, one of these two suites goes red.
//
// Run: deno test supabase/functions/_shared/guardrails_test.ts

import { assert, assertEquals } from "jsr:@std/assert@1";
import { isClean, SAFE_FALLBACK, scan, screenAttrs } from "./guardrails.ts";

const BANNED_PHRASES = [
  "Your money sits in escrow until the job is done.",
  "We remove all fraud from the process.",
  "You are 100% protected.",
  "Every job is fully covered.",
  "We hold your money safely.",
  // The passive. Added 4 Sep 2026, because the active-voice pattern above was
  // the only one there and this is the form the model actually writes.
  "Your money is held and released stage by stage.",
  "We are holding your money until the work is proven.",
];

Deno.test("banned language is caught, same phrases as the Python suite", () => {
  for (const text of BANNED_PHRASES) {
    assert(scan(text).length > 0, `guardrail missed: ${text}`);
    assertEquals(isClean(text), false, `guardrail missed: ${text}`);
  }
});

Deno.test("approved language passes", () => {
  assert(isClean(
    "Payment is held safely with a licensed payment provider and released to the worker "
    + "within 24 hours of your approval. Work is protected up to the guarantee limit.",
  ));
});

Deno.test("the principal wording the assistant now uses passes", () => {
  // The replacement for the retired "money is held" fact. If a future edit
  // widens the passive pattern far enough to catch this, the screen would
  // block the very sentence it is meant to leave standing.
  assert(isClean(
    "You pay Yaadly, not the tradesperson. Yaadly sells you the job at one agreed price, "
    + "engages a vetted tradesperson and pays them directly. Payment terms are agreed in "
    + "writing for each job, and a named person approves every release.",
  ));
});

Deno.test("the fallback a blocked client gets is itself clean", () => {
  // Otherwise a screen failure would send a second thing that fails the screen.
  assert(isClean(SAFE_FALLBACK));
});

Deno.test("an ordinary reply is not blocked", () => {
  assert(isClean(
    "Thanks, I have that. Which parish is the property in, and is anybody there to let a worker in?",
  ));
});

Deno.test("scanning twice returns the same answer", () => {
  // The patterns are module-level /g regexes. A leftover lastIndex between
  // calls silently skips the first hit on the second call, which would mean
  // the screen passing a message it had just blocked.
  const text = "Your money sits in escrow.";
  assertEquals(scan(text).length, scan(text).length);
  assert(scan(text).length > 0);
  assert(scan(text).length > 0);
});

Deno.test("telemetry carries the guidance, never the client's words", () => {
  const attrs = screenAttrs(scan("Your money sits in escrow, and you are 100% protected."));
  assertEquals(attrs["yaadly.guardrail.blocked"], 1);
  const terms = String(attrs["yaadly.guardrail.terms"]);
  assert(terms.includes("escrow"), "expected the escrow guidance");
  assert(!terms.includes("Your money sits"), "the screened text must not reach telemetry");
});

Deno.test("a clean message reports blocked 0 and no terms", () => {
  const attrs = screenAttrs(scan("What needs doing, and which parish is it in?"));
  assertEquals(attrs["yaadly.guardrail.blocked"], 0);
  assertEquals(attrs["yaadly.guardrail.terms"], "");
});

/* ── the gate is wired, and stays wired ──────────────────────────────────────
   The unit tests above prove the screen works. They prove nothing about it
   being switched on, and CLAUDE.md exists because the realistic failure here
   is not a broken regex, it is somebody removing the call in good faith while
   making the reply path tidier or faster.

   yaad-inbound composes a reply with a model and sends it to a real person.
   twiml() is the single place that happens. This asserts the screen is still
   in it. If this test goes red, the change is wrong, not the test. */

const inboundSource = await Deno.readTextFile(
  new URL("../yaad-inbound/index.ts", import.meta.url),
);

Deno.test("yaad-inbound still imports the screen", () => {
  assert(
    inboundSource.includes('from "./guardrails.ts"'),
    "yaad-inbound no longer imports the banned-language screen",
  );
});

Deno.test("yaad-inbound still screens inside the one path to a client", () => {
  const start = inboundSource.indexOf("const twiml = ");
  assert(start > 0, "twiml() is gone or renamed. Whatever replaced it must screen.");
  const body = inboundSource.slice(start, start + 2000);
  assert(body.includes("guardrails.scan("), "twiml() no longer screens the reply");
  assert(body.includes("SAFE_FALLBACK"), "twiml() no longer substitutes a safe reply on a hit");
});

Deno.test("the draft producers still flag banned language", () => {
  for (const fn of ["yaad-completion", "yaad-kickoff"]) {
    const src = Deno.readTextFileSync(new URL(`../${fn}/index.ts`, import.meta.url));
    assert(src.includes("guardrails.scan("), `${fn} no longer screens its draft`);
  }
});

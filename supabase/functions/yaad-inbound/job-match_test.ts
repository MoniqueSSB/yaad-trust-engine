// Proves pickJobChoice() against the ten cases that matter, including the
// two that were the whole point of the fix: a bare "yes" and the bare
// digits without the job's own code never confirm anything, even with only
// one candidate job.
//
// Run: deno test supabase/functions/yaad-inbound/job-match_test.ts

import { assert, assertEquals } from "jsr:@std/assert@1";
import { pickJobChoice, readsAsYes, type JobChoice } from "./job-match.ts";

const ONE: JobChoice[] = [{ id: "JOB-0042", title: "Kitchen tap replacement", stage: 2 }];
const TWO: JobChoice[] = [
  { id: "JOB-0042", title: "Kitchen tap replacement", stage: 2 },
  { id: "JOB-0099", title: "Bathroom tile repair", stage: 1 },
];

Deno.test("the exact code matches, case insensitive", () => {
  assertEquals(pickJobChoice("JOB-0042", ONE)?.id, "JOB-0042");
  assertEquals(pickJobChoice("job-0042", ONE)?.id, "JOB-0042");
});

Deno.test("the code embedded in a longer sentence still matches", () => {
  assertEquals(pickJobChoice("yes it's for JOB-0042 thanks", TWO)?.id, "JOB-0042");
});

Deno.test("the bare digits without the code's own letters do not match", () => {
  // Deliberately strict: a worker has to reply with what the message showed
  // them, not their memory of the number, so a partial guess reprompts
  // rather than silently landing on the wrong job.
  assertEquals(pickJobChoice("0042", TWO), null);
});

Deno.test("a bare 'yes' never confirms anything, even with only one job", () => {
  assertEquals(pickJobChoice("yes", ONE), null);
});

/* ── a yes that points at the job, one candidate only ─────────────────────
   19 Sep 2026. "Yes for that job" was refused on a live job where exactly
   one job had just been named in the question. The bare "yes" rule above is
   untouched and stays: this only reads a yes that says which job it means. */

Deno.test("a yes that points at the job confirms, with only one job", () => {
  for (const said of ["Yes for that job", "yes that one", "yeah that job", "yes it", "correct", "that one", "confirmed", "yep thats the job"]) {
    assertEquals(pickJobChoice(said, ONE)?.id, "JOB-0042", `should confirm: ${said}`);
  }
});

Deno.test("a pointing yes still confirms nothing when two jobs are on the table", () => {
  for (const said of ["Yes for that job", "yes that one", "correct", "that one"]) {
    assertEquals(pickJobChoice(said, TWO), null, `must not guess between two jobs: ${said}`);
  }
});

Deno.test("a yes carrying a doubt, a refusal or a real sentence is not a yes", () => {
  for (const said of [
    "yes", "yes please", "ok", "no", "nah", "no not that one", "yes but the other one",
    "yes the wrong job", "yes i am on site now", "yes but which one do you mean",
  ]) {
    assertEquals(pickJobChoice(said, ONE), null, `must not confirm: ${said}`);
  }
});

Deno.test("readsAsYes is narrow on its own terms", () => {
  assert(readsAsYes("Yes for that job"));
  assert(readsAsYes("correct"));
  assert(!readsAsYes("yes"));
  assert(!readsAsYes("yes please"));
  assert(!readsAsYes("no"));
  assert(!readsAsYes("yes that one is done and the next one starts tomorrow"));
});

/* The prompt promises "Reply 1 to confirm it is that job" (19 Sep 2026), so
   1 has to keep confirming the single job. It always did; the message now
   says so, and this holds the two together. */
Deno.test("1 confirms the only job on offer, as the prompt now promises", () => {
  assertEquals(pickJobChoice("1", ONE)?.id, "JOB-0042");
  assertEquals(pickJobChoice(" 1 ", ONE)?.id, "JOB-0042");
  // Still nothing else. 2 names a job that was never offered.
  assertEquals(pickJobChoice("2", ONE), null);
});

Deno.test("an ordinal number still works as a convenience", () => {
  assertEquals(pickJobChoice("1", TWO)?.id, "JOB-0042");
  assertEquals(pickJobChoice("2", TWO)?.id, "JOB-0099");
});

Deno.test("an ordinal out of range does not match", () => {
  assertEquals(pickJobChoice("3", TWO), null);
});

Deno.test("an unambiguous title match still works", () => {
  assertEquals(pickJobChoice("bathroom", TWO)?.id, "JOB-0099");
});

Deno.test("a title matching more than one job does not guess", () => {
  const ambiguous: JobChoice[] = [
    { id: "JOB-0001", title: "Kitchen tap replacement", stage: 1 },
    { id: "JOB-0002", title: "Kitchen sink replacement", stage: 1 },
  ];
  assertEquals(pickJobChoice("kitchen", ambiguous), null);
});

Deno.test("empty or whitespace-only text never matches", () => {
  assertEquals(pickJobChoice("", TWO), null);
  assertEquals(pickJobChoice("   ", TWO), null);
});

Deno.test("garbage input does not match", () => {
  assertEquals(pickJobChoice("asdkjfh", TWO), null);
});

/* ── the gate stays wired ─────────────────────────────────────────────────
   Proves index.ts is actually running this file's logic rather than a
   second copy of its own that has quietly drifted from it. */
const inboundSource = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("yaad-inbound imports pickJobChoice rather than defining its own", () => {
  assert(inboundSource.includes('from "./job-match.ts"'), "yaad-inbound no longer imports job-match.ts");
  assert(!/\bfunction pickJobChoice\(/.test(inboundSource), "yaad-inbound has grown its own copy of pickJobChoice again");
});

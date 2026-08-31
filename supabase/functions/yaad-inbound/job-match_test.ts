// Proves pickJobChoice() against the ten cases that matter, including the
// two that were the whole point of the fix: a bare "yes" and the bare
// digits without the job's own code never confirm anything, even with only
// one candidate job.
//
// Run: deno test supabase/functions/yaad-inbound/job-match_test.ts

import { assert, assertEquals } from "jsr:@std/assert@1";
import { pickJobChoice, type JobChoice } from "./job-match.ts";

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

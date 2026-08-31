// Proves matchApprovingJob() only ever fires on an exact code match, never
// on the conveniences pickJobChoice() allows itself, because unlike that
// function this one runs against every plain text message a client sends,
// not just a reply inside a session already known to be about picking a
// job.
//
// Run: deno test supabase/functions/yaad-inbound/approval-match_test.ts

import { assert, assertEquals } from "jsr:@std/assert@1";
import { matchApprovingJob, type ApprovableJob } from "./approval-match.ts";

const ONE: ApprovableJob[] = [{ id: "JOB-WEB-1788006231445", title: "Kitchen sink pipe leak", stage: 2 }];
const TWO: ApprovableJob[] = [
  { id: "JOB-WEB-1788006231445", title: "Kitchen sink pipe leak", stage: 2 },
  { id: "JOB-WA-1787995411470", title: "Zinc roof repair or replacement", stage: 1 },
];

Deno.test("the exact code matches, case insensitive", () => {
  assertEquals(matchApprovingJob("JOB-WEB-1788006231445", ONE)?.id, "JOB-WEB-1788006231445");
  assertEquals(matchApprovingJob("job-web-1788006231445", ONE)?.id, "JOB-WEB-1788006231445");
});

Deno.test("the code copy-pasted alongside other words still matches", () => {
  assertEquals(matchApprovingJob("yes approve JOB-WEB-1788006231445 thanks", TWO)?.id, "JOB-WEB-1788006231445");
});

Deno.test("a bare 'yes' never approves anything, even with only one job waiting", () => {
  // The deliberate difference from pickJobChoice(): there is no session
  // boundary here, so an ordinary affirmative reply must not be treated
  // as consent to move money.
  assertEquals(matchApprovingJob("yes", ONE), null);
  assertEquals(matchApprovingJob("approve", ONE), null);
  assertEquals(matchApprovingJob("ok thanks", ONE), null);
});

Deno.test("an ordinal number never approves anything, unlike pickJobChoice", () => {
  // pickJobChoice() treats "1" as "the first option" inside a worker's
  // evidence session. There is no such session for a client's approval
  // reply, so a stray digit in an unrelated message ("on the 1st floor")
  // must never be read as approving the one job awaiting them.
  assertEquals(matchApprovingJob("1", TWO), null);
  assertEquals(matchApprovingJob("the leak is on the 1st floor", TWO), null);
});

Deno.test("a title match never approves anything, unlike pickJobChoice", () => {
  assertEquals(matchApprovingJob("the kitchen sink one", TWO), null);
});

Deno.test("empty or whitespace-only text never matches", () => {
  assertEquals(matchApprovingJob("", TWO), null);
  assertEquals(matchApprovingJob("   ", TWO), null);
});

Deno.test("garbage input does not match", () => {
  assertEquals(matchApprovingJob("asdkjfh", TWO), null);
});

Deno.test("a message naming two jobs at once approves neither", () => {
  assertEquals(matchApprovingJob("JOB-WEB-1788006231445 and JOB-WA-1787995411470 both please", TWO), null);
});

/* ── the gate stays wired ─────────────────────────────────────────────────
   Proves index.ts is actually running this file's logic rather than a
   second copy of its own that has quietly drifted from it. */
const inboundSource = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("yaad-inbound imports matchApprovingJob rather than defining its own", () => {
  assert(inboundSource.includes('from "./approval-match.ts"'), "yaad-inbound no longer imports approval-match.ts");
  assert(inboundSource.includes("approve_stage_via_whatsapp"), "yaad-inbound no longer calls approve_stage_via_whatsapp");
});

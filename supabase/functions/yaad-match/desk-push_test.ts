// Proves the two things about yaad-match that went wrong quietly, both found on
// 6 September 2026 while the job alert list was being built.
//
// Run: deno test --allow-read supabase/functions/yaad-match/desk-push_test.ts

import { assert, assertEquals } from "jsr:@std/assert@1";

const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

/** The body of `for (const w of list) { ... }`, found by matching braces
 *  rather than by guessing, so the test still means something after an edit. */
function workerLoopBody(): string {
  const start = src.indexOf("for (const w of list) {");
  assert(start > 0, "the per worker loop should still exist");
  let i = src.indexOf("{", start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error("the per worker loop is never closed");
}

Deno.test("the desk push happens once per job, not once per matched worker", () => {
  // ntfy_topic is ONE topic and it is the founder's own phone. Inside the loop,
  // a job matching twelve workers buzzed the same handset twelve times.
  assertEquals(
    src.split("ntfy.sh").length - 1, 1,
    "there should be exactly one ntfy call in this file",
  );
  assert(
    !workerLoopBody().includes("ntfy"),
    "the desk push must not be inside the per worker loop",
  );
});

Deno.test("the desk push is never recorded as having told a worker", () => {
  // The worse half of the same bug. Every push also wrote a job_alerts row
  // saying that worker had been told by ntfy, and match_workers_for_job strikes
  // off anybody holding a 'sent' row on ANY channel. A worker whose email
  // bounced was therefore excluded from the next run by a notification that
  // never went near them.
  assert(
    !/channel:\s*["'`]ntfy["'`]/.test(src),
    "nothing in this file may write a job_alerts row on the ntfy channel",
  );
  const rows = src.slice(src.indexOf("const rows = results.map"));
  assert(rows.length > 0, "the job_alerts rows should still be built from results");
});

Deno.test("a worker whose email failed is still eligible for the next run", () => {
  // The other side of the same rule, stated where somebody editing this file
  // will read it: a failure is recorded as a failure, never as sent.
  assert(
    /status:\s*r\.ok\s*\?\s*["'`]sent["'`]\s*:\s*["'`]failed["'`]/.test(src),
    "an email that did not go must be recorded as failed, not sent",
  );
});

Deno.test("nothing a worker or the founder reads carries a dash", () => {
  // House rule, CLAUDE.md section 1. The email body and the desk messages are
  // written on Monique's behalf. Comments are exempt; these are not.
  for (const m of src.matchAll(/(?:subject|Title):\s*`([^`]*)`/g)) {
    assert(!/[‐-―]/.test(m[1]), `dash in: ${m[1]}`);
  }
  const emailBody = src.slice(src.indexOf("A new job just opened"), src.indexOf("You are getting this because"));
  assert(!/[‐-―]/.test(emailBody), "dash in the worker's email body");
});

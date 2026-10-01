// The client's fixed answers, on the worker's side (1 Oct 2026).
//
// Run: deno test --allow-read --allow-env supabase/functions/

import { assert, assertEquals } from "jsr:@std/assert@1";
import { answerWorkerJobQuestion, workerWhereItStands, type WorkerJob } from "./worker-question.ts";
import { CLIENT_LIVE_STATUSES } from "./client-lane.ts";
import * as guardrails from "./guardrails.ts";

const job = (status: string, stagePaid = true): WorkerJob => ({ id: "JOB-WEB-1", title: "Roof", status, stagePaid });

Deno.test("every status the client is answered for has a worker answer that names the next step", () => {
  for (const status of [...CLIENT_LIVE_STATUSES, "complete"]) {
    const s = workerWhereItStands(job(status));
    assert(s.includes("JOB-WEB-1"), s);
    assert(/Do not start|Send photos|reply 1|Nothing is needed|Nothing else|Reply here|Yaadly pays you|Nothing is approved/.test(s), `${status}: ${s}`);
    assertEquals(guardrails.scan(s).length, 0, s);
    assert(!/[–—]/.test(s), s);
  }
  assert(/Do not start it yet/.test(workerWhereItStands(job("in_progress", false))));
});

Deno.test("the worker gets the same five kinds of fixed answer as the client", () => {
  const j = job("in_progress");
  assert(/is live/.test(answerWorkerJobQuestion("where is my job at?", j)!));
  assert(/can i start/i.test("can i start?") && /is live/.test(answerWorkerJobQuestion("can i start?", j)!));
  assert(/client approves each stage/.test(answerWorkerJobQuestion("how does approval work?", j)!));
  assert(answerWorkerJobQuestion("where can i see the kickoff pack?", j)!.includes("/portal/jobs/JOB-WEB-1"));
  assert(/talk to a person/.test(answerWorkerJobQuestion("how do i raise a problem?", j)!));
  assert(/talk to a person/.test(answerWorkerJobQuestion("how do i change my number?", j)!));
  for (const q of ["where is my job at?", "how does approval work?", "where can i see the kickoff pack?", "how do i raise a problem?", "how do i change my number?"]) {
    const a = answerWorkerJobQuestion(q, j)!;
    assertEquals(guardrails.scan(a).length, 0, a);
    assert(!/[–—]/.test(a), a);
    assert(!/\b(?:today|tomorrow|guarantee)\b/i.test(a), a);
  }
});

Deno.test("a pay request is never answered here, and no job means no status answer", () => {
  assertEquals(answerWorkerJobQuestion("pay me for stage 1", job("evidence")), null);
  assertEquals(answerWorkerJobQuestion("what happens next?", null), null);
  assertEquals(answerWorkerJobQuestion("how do i send a video?", job("in_progress")), null);
});

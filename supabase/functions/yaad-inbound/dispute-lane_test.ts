import { assert, assertEquals } from "jsr:@std/assert@1";
import { closedReply, DISPUTE_DAYS, DISPUTE_HOURS, problemForWorker, problemSent, readDisputeClose, replyForClient, replySent } from "./dispute-lane.ts";

const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
const JOB = "JOB-WEB-1789253807959";

Deno.test("the client closes or escalates with the words and the code, nothing less", () => {
  assertEquals(readDisputeClose(`SORTED ${JOB}`), { jobId: JOB, state: "resolved" });
  assertEquals(readDisputeClose(`sorted ${JOB}.`), { jobId: JOB, state: "resolved" });
  assertEquals(readDisputeClose(`NOT FIXED ${JOB}`), { jobId: JOB, state: "escalated" });
  assertEquals(readDisputeClose(`still not fixed ${JOB}`), { jobId: JOB, state: "escalated" });
  for (const said of ["sorted", "not fixed", JOB, "it is sorted now thanks", `the door is still not fixed on ${JOB} and more`, "ok"]) {
    assertEquals(readDisputeClose(said), null, said);
  }
});

Deno.test("every message is short lines, names the next step, and promises nothing about the outcome", () => {
  const texts = [
    problemSent("JOB-1", "The left door does not close."),
    problemForWorker("JOB-1", "Kitchen cupboards", "The left door does not close.", "https://app.yaadly.co.uk/portal/jobs/JOB-1"),
    replySent("I will come Tuesday and re-hang it."),
    replyForClient("JOB-1", "Kitchen cupboards", "I will come Tuesday and re-hang it.", "https://app.yaadly.co.uk/portal/jobs/JOB-1"),
    closedReply("resolved"), closedReply("escalated"),
  ];
  for (const t of texts) {
    assert(!/[–—]/.test(t), "no dashes");
    for (const line of t.split("\n")) assert(line.length <= 120, `long line: ${line}`);
    assert(!/refund|compensation|you will be paid|guarantee|removed|penalt/i.test(t), t);
  }
  assert(problemForWorker("J", "K", "x", "l").includes(`${DISPUTE_HOURS} hours`) && problemSent("J", "x").includes(`${DISPUTE_HOURS} hours`), "the 48 hours are said to both sides (founder, 1 Oct 2026: say 48 hours)");
  assert(problemSent("JOB-1", "x").includes("SORTED JOB-1") && problemSent("JOB-1", "x").includes("NOT FIXED JOB-1"));
  assert(/Nothing (on the job )?is approved/.test(problemSent("J", "x")) && /Nothing is approved/.test(problemForWorker("J", "K", "x", "l")), "approval stays stopped while it is open");
});

Deno.test("on WhatsApp a client's problem opens a dispute for the worker, not a note for the desk", () => {
  const at = src.indexOf("if (readsAsProblem(said)) {");
  assert(at > 0, "the problem branch is gone");
  const block = src.slice(at, at + 1600);
  assert(block.includes('rpc("raise_dispute_via_whatsapp"'), "a problem must open a dispute");
  // Yaadly is only the fallback when the client has more than one live job
  // and which one is not clear; the worker path must come first.
  assert(block.indexOf('rpc("raise_dispute_via_whatsapp"') < block.indexOf("GONE_TO_YAADLY"), "the worker must be tried before Yaadly");
});

Deno.test("the client's close and the worker's reply each touch the dispute and nothing else", () => {
  const close = src.indexOf("a client closing or escalating a dispute");
  const clientLane = src.indexOf("a client on a live job, saying something that is not a code");
  assert(close > 0 && clientLane > close, "the close must be read before the client lane");
  const cb = src.slice(close, clientLane);
  assert(cb.includes('rpc("close_dispute_via_whatsapp"') && !/approve_stage|release|mark_paid|choose_worker/.test(cb));
  const reply = src.indexOf("A worker answering an open problem");
  assert(reply > 0, "the worker reply lane is gone");
  const rb = src.slice(reply, src.indexOf("A day and time for a walkthrough", reply));
  assert(rb.includes('rpc("reply_dispute_via_whatsapp"') && !/from\("evidence"\)|update_draft/.test(rb), "a reply is not evidence and not an update");
});

Deno.test("two days with no reply brings Yaadly in on its own, and the desk hears at escalation only", async () => {
  const mig = await Deno.readTextFile(new URL("../../migrations/20260930130000_a_problem_goes_to_the_worker_first.sql", import.meta.url));
  assert(mig.includes("function public.escalate_stale_disputes"), "no escalation function");
  assert(mig.includes(`interval '${DISPUTE_DAYS} days'`), "the days in the migration must match the words");
  assert(mig.includes("'kind', 'dispute_replied'"), "the client is not told of the reply");
  // The raise trigger tells the worker and the client, and the desk only when
  // a dispute is opened already escalated (a legacy path).
  const raise = mig.slice(mig.indexOf("function public.notify_dispute_raised_to_worker_and_desk"), mig.indexOf("$$;", mig.indexOf("function public.notify_dispute_raised_to_worker_and_desk")));
  assert(raise.includes("if new.state = 'escalated' then"), "the desk must hear at raise only for an escalated open");
});

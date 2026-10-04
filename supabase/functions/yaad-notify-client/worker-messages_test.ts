// Worker WhatsApp fixes, 30 Sep 2026 ("fix the issues", after the review of
// every worker message). Read against the source, because the send path is
// one long handler that cannot be run without Twilio and a database.
//
// Run: deno test --allow-read --allow-env supabase/functions/

import { assert, assertEquals } from "jsr:@std/assert@1";
import { hasWorkerTemplateDecision, workerTemplateSummary } from "./worker-template.ts";
import { jobDelayedWorkerText } from "./worker-cleared.ts";
import { bookedPayLine, completionReportWorkerCopy, stagePaidWorkerText, workerEvidenceLines } from "./worker-copy.ts";
import { runEvidenceChecks } from "./evidence-checks.ts";

const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
const branch = (kind: string) => {
  const at = src.indexOf(`} else if (kind === "${kind}") {`);
  assert(at > 0, `${kind} branch is gone`);
  const next = src.indexOf("} else if (kind ===", at + 10);
  return src.slice(at, next > 0 ? next : at + 4000);
};

Deno.test("follow-ups go after any first message sent as WhatsApp free text, not only the draft", () => {
  const at = src.indexOf("for (const more of waFollowUps)");
  const gate = src.slice(src.lastIndexOf("if (", at), at);
  assert(!gate.includes("waLine"), "the bank details ask is dead again: follow-ups gated on waLine");
  assert(gate.includes("!firstTemplate") && gate.includes('wa.via === "twilio whatsapp"'), "follow-ups must only follow a free text WhatsApp send");
  // The draft still travels alone as the first message.
  assert(src.includes("waLine || line"), "the draft is no longer the first message on its own");
});

Deno.test("a bank details ask WhatsApp could not carry goes by email and shows as not sent", () => {
  assert(src.includes("if (bankAsk && !bankAskSent)"), "the bank ask has no fallback when a template went first");
  for (const k of ["booked_worker", "stage_released_worker", "stage_signed_off_worker"]) {
    assert(branch(k).includes("bankAsk = bankDetailsAsk("), `${k} no longer asks for bank details`);
  }
});

Deno.test("a stage signed off tells the worker, after the approval, and moves nothing", () => {
  assert(src.includes('"stage_signed_off_worker"'), "not a kind");
  assert(hasWorkerTemplateDecision("stage_signed_off_worker"));
  const b = branch("stage_signed_off_worker");
  assert(b.includes('from("stage_approvals")'), "must read the recorded approval, never assume one");
  assert(b.includes('job.status === "complete"'), "the last stage is stage_released_worker's to say");
  assert(/within 7 days/.test(b) && /bank transfer/.test(b) && /Never cash/.test(b), "must say how and when pay comes");
  assert(/Do not start it yet/.test(b), "a by-stage job must not be told to start an unpaid stage");
  assert(!/\.rpc\(|\.update\(|\.insert\(/.test(b), "a notice must never write anything");
  const summary = workerTemplateSummary("stage_signed_off_worker")!;
  assert(!/[\u2013\u2014]/.test(summary) && !/\.$/.test(summary), summary);
});

Deno.test("signed off no longer counts materials twice and says the 7 days", () => {
  const b = branch("stage_released_worker").replace(/\/\/.*$/gm, "");
  assert(!/owes you your labour and materials/.test(b), "materials already sent read as owed again");
  assert(/within 7 days/.test(b), b);
});

Deno.test("outside the window with no fitting template, WhatsApp is not tried and the desk can see it", () => {
  assert(src.includes("workerHeldBack = true"), "held back is never set");
  assert(/if \(workerHeldBack\) \{\s*\n\s*await recordNotSent\(/.test(src), "a held back message is not recorded as not sent");
  assert(src.includes("workerHeldBack ? { sent: false } : await sendMetaWhatsApp"), "Meta has the same window and must not be tried");
  for (const k of ["worker_cleared", "worker_check_reminder"]) {
    const at = src.indexOf(`if (kind === "${k}") {`);
    const b = src.slice(at, at + 2500);
    assert(b.includes("sendToWorker("), `${k} still sends free text without reading the window`);
  }
});

Deno.test("the client's delay message is only true once the worker has been asked", () => {
  const b = src.slice(src.indexOf('} else if (kind === "job_delayed") {'), src.indexOf('} else if (kind.startsWith("addon_")) {'));
  const sendAt = b.indexOf("sendToWorker(");
  const lineAt = b.indexOf("line = ");
  assert(sendAt > 0 && sendAt < lineAt, "the worker must be messaged before the client is told so");
  assert(b.includes("workerReached ?"), "the client wording must follow what actually happened");
  const t = jobDelayedWorkerText("JOB-1", "Roof");
  assert(t.startsWith("JOB-1 (Roof): ") && /Reply here and a person will help\.$/.test(t), t);
  assert(!/[\u2013\u2014]/.test(t) && !/late fee|penalt|warning/i.test(t), t);
});

Deno.test("worker copy says client, never owner, and the add-on is approved by the client", () => {
  const cr = branch("completion_report_worker");
  assert(!/\bowner\b/.test(cr.replace(/\/\/.*$/gm, "")), "owner in worker copy");
  // The wording moved to worker-copy.ts on 30 Sep 2026 so it can be run;
  // the requirement is unchanged: the buttons are named only when there are
  // buttons, and the report goes to the client only when the worker signs.
  assert(/completionReportWorkerCopy\(\{[\s\S]*buttons: hasSignButtons/.test(cr), "the buttons are named even when there are none");
  assert(/waLine = copy\.waLine/.test(cr), "the button version is not the WhatsApp text the buttons follow");
  const withB = completionReportWorkerCopy({ title: "Roof", jobId: "JOB-1", signLink: "L", buttons: true, clip: (x) => x });
  const without = completionReportWorkerCopy({ title: "Roof", jobId: "JOB-1", signLink: "L", buttons: false, clip: (x) => x });
  for (const t of [withB.line, withB.waLine, without.line]) assert(/goes to the client only when you sign/.test(t), t);
  assert(!/button/i.test(without.line) && without.waLine === "", "the buttons are named even when there are none");
  const at = src.indexOf('} else if (kind === "addon_paid_worker") {');
  const addon = src.slice(at, at + 900).replace(/\/\/.*$/gm, "");
  assert(/The client approves it/.test(addon) && !/Yaadly signs it off/.test(addon), addon);
});

Deno.test("the dead worker-confirm kind is gone", () => {
  assert(!src.includes('"quote_awaiting_worker_confirm"'), "the removed worker confirm step is still a kind");
  assertEquals(workerTemplateSummary("quote_awaiting_worker_confirm"), null);
});

Deno.test("the check-in is asked only where it applies, and never as a gate", () => {
  for (const k of ["booked_worker", "job_live_worker"]) {
    const b = branch(k);
    assert(b.includes("checkInAsked(admin, jobId)"), `${k} asks everybody to check in`);
    assert(!/check in first/.test(b), `${k} still reads as a gate`);
    assert(/voice note/.test(b), `${k} does not say the words can be a voice note`);
  }
});

// ── 30 Sep 2026, the second pass ────────────────────────────────────────

const noDash = (t: string) => assert(!/[\u2013\u2014]/.test(t), `dash in: ${t}`);

Deno.test("a missing check-in is a tip, never under Still missing, and the video stays", () => {
  // Photos only, no check-in, no location, on a job where a check-in is asked.
  const checks = runEvidenceChecks({
    stage: 1,
    evidence: [{ mime: "image/jpeg", created_at: "2026-09-30T15:00:00Z" }],
    arrivals: [], pins: [], checklist: null, arrivalExpected: true,
  } as never);
  const { missing, tips } = workerEvidenceLines(checks);
  const all = [...missing, ...tips].join("\n");
  assert(!missing.some((m) => /check-in|check in|location/i.test(m)), `the check-in is listed as missing: ${missing}`);
  assert(missing.some((m) => /video/i.test(m)), "the video is no longer asked for");
  assertEquals(tips.filter((t) => /location/i.test(t)).length, 1, "the check-in and the location are one tip, not two");
  assert(tips.some((t) => /^Tip: check in with your location when you arrive\./.test(t)), tips.join("|"));
  assert(!/\bclips?\b|stage pack|Arrival Log|harder to argue|\bpack\b/i.test(all), all);
  noDash(all);
  // A check-in logged that day: nothing about it at all.
  const ok = workerEvidenceLines(runEvidenceChecks({
    stage: 1,
    evidence: [{ mime: "video/mp4", created_at: "2026-09-30T15:00:00Z" }],
    arrivals: [{ arrived_at: "2026-09-30T13:00:00Z", lat: 18, lon: -76.8 }], pins: [], checklist: null, arrivalExpected: true,
  } as never));
  assertEquals(ok.missing, []);
  assertEquals(ok.tips, []);
});

Deno.test("the evidence message uses the worker presentation, not the raw gaps", () => {
  const at = src.indexOf("const evChecks = await assembleEvidenceChecks");
  const b = src.slice(at, at + 900);
  assert(b.includes("workerEvidenceLines(evChecks)"), "the raw check details reach the worker again");
  assert(!/workerGaps\(|workerNotes\(/.test(src), "the raw gaps list is back in the worker message");
});

Deno.test("a stage paid tells the worker, only off a paid stage bill on the stage being worked", () => {
  assert(src.includes('"stage_paid_worker"'), "not a kind");
  assert(hasWorkerTemplateDecision("stage_paid_worker"));
  const b = branch("stage_paid_worker");
  assert(/\.from\("invoices"\)/.test(b) && /meta\.invoiceId/.test(b), "must read the invoice off the row");
  assert(/inv\.status !== "paid"/.test(b), "must check the bill is marked paid");
  assert(/inv\.starts_job/.test(b) && /inv\.addon_id/.test(b) && /inv\.part_of/.test(b), "must not fire for the start bill, add-ons or parts");
  assert(/paidStage !== Number\(job\.stage/.test(b), "a stage paid ahead must not say start now");
  assert(!/\.rpc\(|\.update\(|\.insert\(/.test(b), "a notice must never write anything");
  const t = stagePaidWorkerText("JOB-1", "Roof", "Stage 2: walls", "https://x/y");
  assert(t.startsWith("JOB-1 (Roof): the client has paid for Stage 2: walls. You can start it now."), t);
  assert(/photos and videos/.test(t), t);
  noDash(t);
  const summary = workerTemplateSummary("stage_paid_worker")!;
  noDash(summary);
  assert(!/\.$/.test(summary), summary);
});

Deno.test("the stage paid trigger follows a person marking a stage bill paid, and nothing else", async () => {
  const sql = await Deno.readTextFile(new URL("../../migrations/20260930180000_the_worker_hears_when_a_stage_bill_is_paid.sql", import.meta.url));
  const code = sql.replace(/--.*$/gm, "");
  assert(/after update of status on public\.invoices/.test(code));
  assert(/new\.status = 'paid'\s+and old\.status is distinct from 'paid'/.test(code), "must fire only on the change into paid");
  assert(/not coalesce\(new\.starts_job, false\)/.test(code), "the start bill is job_live_worker's");
  assert(/new\.addon_id is null/.test(code) && /new\.part_of is null/.test(code));
  assert(/_job_is_billed_by_stage\(new\.job_id\)/.test(code));
  assert(/'kind', 'stage_paid_worker'/.test(code) && /notify_trigger_secret\(\)/.test(code));
  assert(!/update public\.|insert into|delete from/i.test(code), "a notice trigger must never write");
  noDash(sql);
});

Deno.test("a by-stage job does not tell the worker to start an unpaid first stage", () => {
  const b = branch("job_live_worker");
  assert(b.includes("stageBillPaid(admin, jobId, firstStage)"), "the first stage bill is not read");
  assert(/Do not start it yet/.test(b), b);
  const s = branch("stage_signed_off_worker");
  assert(/You get a message here when they have/.test(s), "the promise stage_paid_worker keeps is not made");
});

Deno.test("the job live summary asks for the location and never makes it a must", () => {
  const s = workerTemplateSummary("job_live_worker")!;
  assert(/location/.test(s), s);
  assert(/if you can/.test(s) && !/to check in$/.test(s), s);
  noDash(s);
});

Deno.test("no accepted quote means no pay figure, never J$0", () => {
  const money = (n: number) => `J$${n.toLocaleString("en-US")}`;
  assertEquals(bookedPayLine(null, money), null);
  assertEquals(bookedPayLine(undefined, money), null);
  assertEquals(bookedPayLine({ labour_jmd: 0, materials_jmd: 0 }, money), null);
  assertEquals(bookedPayLine({ labour_jmd: 10000, materials_jmd: 2000 }, money),
    "Your pay: J$9,300 for labour. Materials J$2,000 at cost. Total J$11,300.");
  const b = branch("booked_worker");
  assert(b.includes("bookedPayLine(q, money)") && /payLine \? `` : null/.test(b), "the pay line is not optional");
  assert(!/Your pay: \$\{money/.test(b), "the old always-on figure is back");
});
